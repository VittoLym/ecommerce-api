import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { CheckoutDto } from './dto/checkout.dto';
import { CartService } from 'src/cart/cart.service';
import { createHash } from 'crypto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  constructor(
    private prisma: PrismaService,
    private cartService: CartService,
  ) {}
  async checkout(userId: number, dto: CheckoutDto) {
    // ============================================
    // 🛡️ IDEMPOTENCIA: Verificar si ya se procesó esta key
    // ============================================
    const existingKey = await this.prisma.idempotencyKey.findUnique({
      where: {
        userId_id: {
          userId,
          id: dto.idempotencyKey,
        },
      },
    });
    if (existingKey && existingKey.expiresAt > new Date()) {
      this.logger.log(`Idempotency key reused: ${dto.idempotencyKey}`);
      if (existingKey.resourceId) {
        const order = await this.prisma.order.findUnique({
          where: { id: existingKey.resourceId },
          include: {
            items: { include: { product: true } },
            payments: { take: 1, orderBy: { createdAt: 'desc' } },
          },
        });

        return {
          success: true,
          message: 'Orden recuperada (idempotent)',
          data: {
            order: this.transformOrder(order),
            idempotent: true,
            cachedResponse: existingKey.response,
          },
        };
      } else {
        // Si hay respuesta cacheada sin resourceId, retornarla
        return existingKey.response;
      }
    }

    // Si la key existe pero expiró, permitir nuevo uso pero con advertencia
    if (existingKey && existingKey.expiresAt <= new Date()) {
      await this.prisma.idempotencyKey.delete({
        where: {
          userId_id: {
            userId,
            id: dto.idempotencyKey,
          },
        },
      });
    }

    // ============================================
    // 🛡️ IDEMPOTENCIA: Generar hash de la petición
    // ============================================
    const requestHash = this.generateRequestHash(userId, dto);

    // Verificar si ya se procesó exactamente la misma petición
    const duplicateRequest = await this.prisma.idempotencyKey.findFirst({
      where: {
        userId,
        requestHash,
        expiresAt: { gt: new Date() },
      },
    });

    if (duplicateRequest) {
      throw new ConflictException(
        'Esta petición ya fue procesada con una key diferente'
      );
    }

    // Validar usuario
    const user = await this.prisma.user.findUnique({
      where: { id: userId, isActive: true },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado o inactivo');
    }

    // ============================================
    // TRANSACCIÓN CON IDEMPOTENCIA
    // ============================================
    return this.prisma.$transaction(
      async (tx) => {
        await tx.idempotencyKey.create({
          data: {
            id: dto.idempotencyKey,
            userId,
            resource: 'checkout',
            requestHash,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 horas
            createdAt: new Date(),
          },
        });

        try {
          // 2️⃣ Obtener carrito con lock pesimista
          const cart = await tx.cart.findUnique({
            where: { userId },
            include: {
              items: {
                include: {
                  product: {
                    select: {
                      id: true,
                      name: true,
                      price: true,
                      stock: true,
                      sku: true,
                      isAvailable: true,
                    },
                  },
                },
              },
            },
          });

          if (!cart) {
            throw new BadRequestException('Carrito no encontrado');
          }

          if (!cart.items || cart.items.length === 0) {
            throw new BadRequestException('El carrito está vacío');
          }

          // 3️⃣ Validar checkout
          await this.validateCheckout(cart.items);

          // 4️⃣ Validar y descontar stock
          for (const item of cart.items) {
            if (!item.product.isAvailable) {
              throw new ConflictException(
                `El producto ${item.product.name} no está disponible`,
              );
            }

            const updated = await tx.product.updateMany({
              where: {
                id: item.productId,
                stock: { gte: item.quantity },
              },
              data: {
                stock: { decrement: item.quantity },
                totalSold: { increment: item.quantity },
                lastSoldAt: new Date(),
              },
            });

            if (updated.count === 0) {
              const product = await tx.product.findUnique({
                where: { id: item.productId },
                select: { stock: true },
              });

              throw new ConflictException({
                message: `Stock insuficiente para ${item.product.name}`,
                available: product?.stock || 0,
                requested: item.quantity,
              });
            }

            await tx.stockMovement.create({
              data: {
                productId: item.productId,
                type: 'DECREMENT',
                quantity: item.quantity,
                previousStock: item.product.stock,
                newStock: item.product.stock - item.quantity,
                referenceType: 'ORDER',
                reason: 'Compra de producto',
              },
            });
          }

          // 5️⃣ Crear orden
          const subtotal = cart.items.reduce(
            (sum, item) => sum + item.quantity * item.product.price,
            0,
          );
          const tax = Math.round(subtotal * 0.19);
          const shipping = subtotal > 100000 ? 0 : 10000;
          const total = subtotal + tax + shipping;
          const orderNumber = await this.generateOrderNumber(tx);
          const order = await tx.order.create({
            data: {
              orderNumber,
              userId,
              subtotal,
              tax,
              shipping,
              total,
              status: OrderStatus.PENDING,
              notes: dto.notes,
            },
          });

          // 6️⃣ Crear order items
          await tx.orderItem.createMany({
            data: cart.items.map((item) => ({
              orderId: order.id,
              productId: item.productId,
              quantity: item.quantity,
              price: item.product.price,
              subtotal: item.quantity * item.product.price,
              productSnapshot: {
                name: item.product.name,
                sku: item.product.sku,
                price: item.product.price,
              },
            })),
          });

          // 7️⃣ Actualizar movimientos de stock
          await tx.stockMovement.updateMany({
            where: {
              productId: { in: cart.items.map((i) => i.productId) },
              referenceType: 'ORDER',
              referenceId: null,
            },
            data: { referenceId: order.id },
          });

          // 8️⃣ Crear payment
          const payment = await tx.paymentAttempt.create({
            data: {
              orderId: order.id,
              amount: total,
              status: PaymentStatus.PENDING,
              provider: 'MOCK',
              paymentMethod: dto.paymentMethod || PaymentMethod.TRANSFER,
              isRefundable: true,
              metadata: {
                idempotencyKey: dto.idempotencyKey,
                checkoutType: 'standard',
              },
            },
          });

          // 9️⃣ Limpiar carrito
          await tx.cartItem.deleteMany({
            where: { cartId: cart.id },
          });

          // 🔟 Registrar actividad
          await tx.userActivity.create({
            data: {
              userId,
              action: 'ORDER_CREATED',
              metadata: {
                orderId: order.id,
                orderNumber,
                idempotencyKey: dto.idempotencyKey,
              },
            },
          });

          // 1️⃣1️⃣ ACTUALIZAR IDEMPOTENCY KEY con el resultado
          const response = {
            success: true,
            message: 'Orden creada exitosamente',
            data: {
              order: this.transformOrder({
                ...order,
                items: cart.items.map(item => ({
                  ...item,
                  product: item.product,
                })),
                payment: [payment],
              }),
              payment: {
                id: payment.id,
                status: payment.status,
                amount: payment.amount,
                paymentMethod: payment.paymentMethod,
              },
              summary: {
                subtotal,
                tax,
                shipping,
                total,
                itemsCount: cart.items.length,
              },
            },
          };

          await tx.idempotencyKey.update({
            where: { 
              userId_id: { 
                userId, 
                id: dto.idempotencyKey 
              } 
            },
            data: {
              resourceId: order.id,
              response,
            },
          });

          return response;

        } catch (error) {
          // Si hay error, eliminar la idempotency key para permitir reintento
          await tx.idempotencyKey.delete({
            where: {
              userId_id: {
                userId,
                id: dto.idempotencyKey,
              },
            },
          }).catch(() => {}); // Ignorar error si no existe
          
          throw error;
        }
      },
      {
        isolationLevel: 'Serializable',
        timeout: 15000,
      },
    );
  }
  private generateRequestHash(userId: number, dto: CheckoutDto): string {
    const data = {
      userId,
      paymentMethod: dto.paymentMethod,
      notes: dto.notes,
      timestamp: new Date().toISOString().split('T')[0], // Solo fecha, no hora
    };
    return createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }
  async cancelIdempotencyKey(userId: number, key: string) {
    await this.prisma.idempotencyKey.delete({
      where: {
        userId_id: {
          userId,
          id: key,
        },
      },
    });

    return { success: true, message: 'Idempotency key liberada' };
  }
  private async validateCheckout(items: any[]) {
    for (const item of items) {
      if (item.quantity <= 0) {
        throw new BadRequestException(
          `Cantidad inválida para ${item.product.name}`,
        );
      }
      if (item.quantity! > 10) {
        throw new BadRequestException(
          `No puedes comprar más de 10 unidades de ${item.product.name}`,
        );
      }

      // Validar precio no ha cambiado drásticamente
      // if (Math.abs(item.product.price - item.product.originalPrice) > 0.2 * item.product.originalPrice) {
      //   throw new ConflictException(`El precio de ${item.product.name} ha cambiado. Por favor, revisa tu carrito.`);
      // }
    }
    const subtotal = items.reduce(
      (sum, i) => sum + i.quantity * i.product.price,
      0,
    );
    if (subtotal < 10000) {
      throw new BadRequestException(
        'El monto mínimo de compra es $10.000 COP',
      );
    }
  }
  private async generateOrderNumber(tx: any): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    const lastOrder = await tx.order.findFirst({
      where: {
        orderNumber: {
          startsWith: `ORD-${year}${month}${day}`,
        },
      },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true },
    });

    let sequence = 1;
    if (lastOrder) {
      const lastSequence = parseInt(lastOrder.orderNumber.split('-')[2]);
      sequence = lastSequence + 1;
    }

    return `ORD-${year}${month}${day}-${String(sequence).padStart(4, '0')}`;
  }
  private async processMockPayment(tx: any, paymentId: number) {
    // Simular procesamiento de pago
    await new Promise((resolve) => setTimeout(resolve, 500));

    const success = Math.random() > 0.1; // 90% de éxito

    return tx.paymentAttempt.update({
      where: { id: paymentId },
      data: {
        status: success ? PaymentStatus.COMPLETED : PaymentStatus.FAILED,
        transactionId: success ? `mock_tx_${Date.now()}` : null,
        errorMessage: success ? null : 'Pago rechazado por el banco emisor',
        updatedAt: new Date(),
      },
    });
  }
  private getPaymentRedirectUrl(payment: any): string | null {
    if (payment.status === PaymentStatus.PENDING) {
      if (['PSE', 'NEQUI', 'DAVIPLATA'].includes(payment.paymentMethod)) {
        return `https://checkout.example.com/pay/${payment.id}`;
      }
    }
    return null;
  }
  private calculateEstimatedDelivery(): Date {
    const date = new Date();
    date.setDate(date.getDate() + 3); // 3 días hábiles
    return date;
  }
  private transformOrder(order: any) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      total: order.total,
      formattedTotal: this.formatCurrency(order.total),
      subtotal: order.subtotal,
      tax: order.tax,
      shipping: order.shipping,
      items: order.items.map((item: any) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        price: item.price,
        formattedPrice: this.formatCurrency(item.price),
        quantity: item.quantity,
        subtotal: item.subtotal,
        formattedSubtotal: this.formatCurrency(item.subtotal),
        image: item.product.image,
      })),
      createdAt: order.createdAt,
      createdAtFormatted: order.createdAt.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
  }
  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(amount);
  }
  findByUser(userId: number) {
    return this.prisma.order.findMany({
      where: { userId },
      include: {
        items: { include: { product: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async getPaidOrder(id: number) {
    return await this.prisma.order.findFirst({
      where: { id },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        payments: true,
      },
    });
  }
  async refund(orderId: number, userId: number) {
    const order = await this.getPaidOrder(orderId);
    return this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.create({
        data: {
          orderId,
          amount: -order!.total,
          provider: 'MOCK',
          status: 'REFUNDED',
          paymentMethod: 'TRANSFER',
        },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'REFUNDED' },
      });
      if (order === null) return;
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { increment: item.quantity },
          },
        });
      }
      return { ok: true };
    });
  }
  async findAllUser() {
    return this.prisma.order.findMany();
  }
}
