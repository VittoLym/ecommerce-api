import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrderStatus, Prisma } from '@prisma/client';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { GetPaymentsDto } from './dto/get-payments.dto';

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
  async findAllPayments(params: {
    page: number;
    limit: number;
    status?;
    startDate?: string;
    endDate?: string;
    userId?: number;
    orderId?: number;
    transactionId?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const {
      page,
      limit,
      status,
      startDate,
      endDate,
      userId,
      orderId,
      transactionId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const skip = (page - 1) * limit;
    const where: Prisma.PaymentAttemptWhereInput = {};

    if (status) where.status = status;
    if (userId) where.order = { userId };
    if (orderId) where.orderId = orderId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    const orderByField = this.validateSortField(sortBy);
    const orderBy: Prisma.PaymentAttemptOrderByWithRelationInput = {
      [orderByField]: sortOrder,
    };

    try {
      const [payments, total, totalAmount, summary] = await Promise.all([
        this.prisma.paymentAttempt.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            order: {
              select: {
                id: true,
                total: true,
                status: true,
                user: {
                  select: {
                    id: true,
                    email: true,
                  },
                },
              },
            },
          },
        }),

        this.prisma.paymentAttempt.count({ where }),
        this.prisma.paymentAttempt.aggregate({
          where: {
            ...where,
            status: 'SUCCESS',
          },
          _sum: {
            amount: true,
          },
        }),
        this.prisma.paymentAttempt.groupBy({
          by: ['status'],
          where,
          _count: {
            _all: true,
          },
          _sum: {
            amount: true,
          },
        }),
      ]);
      const transformedPayments = payments.map(payment => ({
        ...payment,
        order: payment
          ? {
              ...payment,
            }
          : null,
        formattedAmount: this.formatCurrency(payment.amount),
        createdAtFormatted: payment.createdAt.toLocaleDateString('es-ES', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      }));

      const summaryMap = summary.reduce((acc, item) => {
          acc[item.status] = {
            count: item._count._all,
            totalAmount: item._sum.amount || 0,
          };
          return acc;
        },
        {} as Record<string, { count: number; totalAmount: number }>,
      );

      return {
        payments: transformedPayments,
        total,
        totalAmount: totalAmount._sum.amount || 0,
        page,
        limit,
        pages: Math.ceil(total / limit),
        summary: {
          byStatus: summaryMap,
          successfulPayments: summaryMap['COMPLETED']?.count || 0,
          failedPayments: summaryMap['FAILED']?.count || 0,
          pendingPayments: summaryMap['PENDING']?.count || 0,
        },
      };
    } catch (error) {
      console.error('Error en findAllPayments:', error);
      throw error;
    }
  }
  private validateSortField(sortBy: string): string {
    const allowedFields = ['createdAt', 'updatedAt', 'amount', 'id'];
    return allowedFields.includes(sortBy) ? sortBy : 'createdAt';
  }
  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }
  async getPaymentsStatistics(
    range: 'today' | 'week' | 'month' | 'year' = 'month',
  ) {
    const now = new Date();
    let startDate: Date;

    switch (range) {
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = new Date(now.setMonth(now.getMonth() - 1));
    }

    const where: Prisma.PaymentAttemptWhereInput = {
      createdAt: {
        gte: startDate,
      },
    };

    const [total, successful, failed, totalAmount, dailyStats] = await Promise.all([
        this.prisma.paymentAttempt.count({ where }),
        this.prisma.paymentAttempt.count({ where: { ...where, status: 'SUCCESS' } }),
        this.prisma.paymentAttempt.count({ where: { ...where, status: 'FAILED' } }),
        this.prisma.paymentAttempt.aggregate({
          where: { ...where, status: 'SUCCESS' },
          _sum: { amount: true },
        }),
        this.getDailyPaymentStats(startDate),
      ]);

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      totalAmount: totalAmount._sum.amount || 0,
      averageAmount: successful > 0 ? (totalAmount._sum.amount || 0) / successful : 0,
      dailyStats,
    };
  }
  private async getDailyPaymentStats(startDate: Date) {
    const payments = await this.prisma.paymentAttempt.findMany({
      where: {
        createdAt: { gte: startDate },
        status: 'SUCCESS',
      },
      select: {
        amount: true,
        createdAt: true,
      },
    });

    const dailyStats = payments.reduce((acc, payment) => {
        const date = payment.createdAt.toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = { count: 0, amount: 0 };
        }
        acc[date].count++;
        acc[date].amount += payment.amount;
        return acc;
      },
      {} as Record<string, { count: number; amount: number }>,
    );

    return dailyStats;
  }
}
