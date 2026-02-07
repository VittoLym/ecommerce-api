import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrderStatus, Prisma } from '@prisma/client';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  private transformOrder(order: any) {
    const items = order.items.map(item => ({
      ...item,
      subtotal: item.price * item.quantity,
      product: {
        ...item.product,
        // Si necesitas URL de imagen completa
        imageUrl: item.product.image 
          ? `${process.env.APP_URL}/uploads/${item.product.image}`
          : null,
      },
    }));
    // Calcular total de items (como validación)
    const calculatedTotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const latestPayment = order.payment.length > 0 ? order.payment[0] : null;
    const shipping = order.shipping || null;

    return {
      id: order.id,
      userId: order.userId,
      user: order.user,
      total: order.total,
      calculatedTotal, // Para validar que coincida
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items,
      payments: order.payment,
      latestPayment,
      shipping,
      itemsCount: items.length,
      isTotalValid: order.total === calculatedTotal,
      formattedDates: {
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt?.toISOString() || null,
      },
    };
  }

  async findAllOrders(params: {
    page: number;
    limit: number;
    status?: OrderStatus;
  }) {
    const { page, limit, status } = params;
    const skip = (page - 1) * limit;
    const where: Prisma.OrderWhereInput = {};
    if (status) {
      where.status = status;
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  price: true,
                },
              },
            },
          },
          user: {
            select: {
              id: true,
              email: true,
            },
          },
          payment: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              status: true,
              amount: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    const transformedOrders = orders.map((order) => ({
      ...order,
      items: order.items.map((item) => ({
        ...item,
        subtotal: item.product.price * item.quantity,
      })),
      latestPayment: order.payment[0] || null,
      payment: undefined,
    }));

    return {
      orders: transformedOrders,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
      limit,
    };
  }

  async findOrder(id: number) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                },
              },
            },
            orderBy: {
              id: 'asc',
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              createdAt: true,
            },
          },
          payment: {
            orderBy: {
              createdAt: 'desc',
            },
            select: {
              id: true,
              status: true,
              amount: true,
              createdAt: true,
            },
          },
        },
      });

      if (!order) {
        return null;
      }
      return this.transformOrder(order);
    } catch (error) {
      console.error(`Error en findOrder para ID ${id}:`, error);
      throw error;
    }
  }

  async changeStatusOrder(id: number, dto: UpdateOrderStatusDto) {
    // 1. Verificar que la orden existe
    const existingOrder = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true, userId: true, total: true },
    });
    if (!existingOrder) {
      throw new NotFoundException(`Orden con ID ${id} no encontrada`);
    }
    this.validateStatusTransition(existingOrder.status, dto.status);
    return await this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status: dto.status,
        },
        include: {
          items: true,
          user: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      });
      await this.handleStatusSpecificActions(id, dto.status, tx);
      return {
        success: true,
        message: `Orden ${id} actualizada de ${existingOrder.status} a ${dto.status}`,
        order: updatedOrder,
        previousStatus: existingOrder.status,
        newStatus: dto.status,
      };
    });
  }

  private validateStatusTransition(
    currentStatus: OrderStatus,
    newStatus: OrderStatus,
  ) {
    const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
      PENDING: ['PENDING', 'CANCELLED'],
      PAID: ['PENDING', 'SHIPPED', 'REFUNDED'],
      FAILED: ['FAILED', 'CANCELLED'],
      SHIPPED: ['PAID', 'SHIPPED'],
      CANCELLED: [],
      REFUNDED: [],
    };
    if (!allowedTransitions[currentStatus]) {
      return;
    }
    if (!allowedTransitions[currentStatus].includes(newStatus)) {
      throw new BadRequestException(
        `No se puede cambiar el estado de ${currentStatus} a ${newStatus}. ` +
        `Transiciones permitidas: ${allowedTransitions[currentStatus].join(', ') || 'ninguna'}`
      );
    }
    if (currentStatus === 'CANCELLED' || currentStatus === 'SHIPPED') {
      throw new BadRequestException(
        `No se puede modificar una orden en estado ${currentStatus}`,
      );
    }
  }
  private async handleStatusSpecificActions(
    orderId: number,
    newStatus: OrderStatus,
    tx: any,
  ) {
    switch (newStatus) {
      case 'CANCELLED':
        await this.releaseInventory(orderId, tx);
        await this.sendCancellationNotification(orderId);
        break;
      case 'SHIPPED':
        await this.createShippingRecord(orderId, tx);
        await this.generateTrackingNumber(orderId, tx);
        break;
      case 'PAID':
        await this.markAsDelivered(orderId, tx);
        await this.calculateCommissions(orderId, tx);
        break;
      case 'REFUNDED':
        await this.processRefund(orderId, tx);
        await this.sendRefundNotification(orderId);
        break;
    }
  }
  private async releaseInventory(orderId: number, tx: any) {
    const orderItems = await tx.orderItem.findMany({
      where: { orderId },
      include: { product: true },
    });
    for (const item of orderItems) {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stock: {
            increment: item.quantity,
          },
        },
      });
    }
  }
  private async createShippingRecord(orderId: number, tx: any) {
    const existingShipping = await tx.shipping.findFirst({
      where: { orderId },
    });
    if (!existingShipping) {
      await tx.shipping.create({
        data: {
          orderId,
          status: 'SHIPPED',
          shippingMethod: 'STANDARD',
          estimatedDelivery: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 días
        },
      });
    }
  }
  private async generateTrackingNumber(orderId: number, tx: any) {
    const trackingNumber = `TRK${Date.now()}${orderId}`;
    await tx.shipping.update({
      where: { orderId },
      data: { trackingNumber },
    });
  }
  private async sendCancellationNotification(orderId: number) {
    console.log(`Enviando notificación de cancelación para orden ${orderId}`);
  }
  private async sendRefundNotification(orderId: number) {
    console.log(`Enviando notificación de reembolso para orden ${orderId}`);
  }
  private async processRefund(orderId: number, tx: any) {
    console.log(`Procesando reembolso para orden ${orderId}`);
  }
  private async markAsDelivered(orderId: number, tx: any) {
    await tx.shipping.update({
      where: { orderId },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
      },
    });
  }
  private async calculateCommissions(orderId: number, tx: any) {
    console.log(`Calculando comisiones para orden ${orderId}`);
  }
}
