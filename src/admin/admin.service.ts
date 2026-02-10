import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrderStatus, Prisma, PaymentStatus } from '@prisma/client';
import { StockMovementType } from '@prisma/client';
import { Role } from '@prisma/client';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { RestockDto } from './dto/restock.dto';
import { GetUsersDto } from './dto/get-users.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

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
          payments: {
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
      latestPayment: order.payments[0] || null,
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
          payments: {
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
      PENDING: ['PENDING', 'CANCELLED', 'PAID'],
      PAID: ['SHIPPED', 'REFUNDED'],
      FAILED: ['FAILED', 'CANCELLED'],
      SHIPPED: ['DELIVERED', 'RETURNED'],
      CANCELLED: [],
      REFUNDED: [],
      PROCESSING: ['PAID', 'FAILED', 'CANCELLED'],
      COMPLETED: [],
      DELIVERED: ['RETURNED'],
      RETURNED: [],
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
  async orderExists(orderId: number): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    return !!order;
  }
  async getOrderPaymentAttempts(orderId: number) {
    try {
      const attempts = await this.prisma.paymentAttempt.findMany({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            select: {
              id: true,
              total: true,
              status: true,
              orderNumber: true,
              user: {
                select: {
                  id: true,
                  email: true,
                },
              },
            },
          },
        },
      });
      return attempts.map(attempt => this.transformPaymentAttempt(attempt));
    } catch (error) {
      console.error(
        `Error en getOrderPaymentAttempts para orden ${orderId}:`,
        error,
      );
      throw error;
    }
  }
  private transformPaymentAttempt(attempt: any) {
    const baseAttempt = {
      id: attempt.id,
      orderId: attempt.orderId,
      amount: attempt.amount,
      formattedAmount: this.formatCurrency(attempt.amount),
      status: attempt.status,
      paymentMethod: attempt.paymentMethod,
      provider: attempt.provider,
      transactionId: attempt.transactionId,
      cardLast4: attempt.cardLast4,
      cardBrand: attempt.cardBrand,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
      isRefundable: attempt.isRefundable,
      refundedAmount: attempt.refundedAmount,
      formattedRefundedAmount: attempt.refundedAmount 
        ? this.formatCurrency(attempt.refundedAmount)
        : null,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
      createdAtFormatted: attempt.createdAt.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      statusDetails: this.getStatusDetails(attempt.status),
      paymentMethodFormatted: this.formatPaymentMethod(attempt.paymentMethod),
      isSuccessful: attempt.status === 'COMPLETED',
      isFailed: attempt.status === 'FAILED',
      isPending: attempt.status === 'PENDING',
    };
    if (attempt.order) {
      return {
        ...baseAttempt,
        order: {
          id: attempt.order.id,
          orderNumber: attempt.order.orderNumber,
          total: attempt.order.total,
          formattedTotal: this.formatCurrency(attempt.order.total),
          status: attempt.order.status,
          user: attempt.order.user,
        },
      };
    }
    return baseAttempt;
  }
  private getStatusDetails(status: PaymentStatus) {
    const statusMap = {
      PENDING: {
        label: 'Pendiente',
        description: 'El pago está pendiente de procesamiento',
        color: 'warning',
        icon: 'clock',
      },
      PROCESSING: {
        label: 'Procesando',
        description: 'El pago está siendo procesado',
        color: 'info',
        icon: 'sync',
      },
      COMPLETED: {
        label: 'Completado',
        description: 'El pago fue exitoso',
        color: 'success',
        icon: 'check-circle',
      },
      FAILED: {
        label: 'Fallido',
        description: 'El pago falló',
        color: 'danger',
        icon: 'x-circle',
      },
      REFUNDED: {
        label: 'Reembolsado',
        description: 'El pago fue reembolsado',
        color: 'info',
        icon: 'refresh-cw',
      },
      CANCELLED: {
        label: 'Cancelado',
        description: 'El pago fue cancelado',
        color: 'secondary',
        icon: 'x',
      },
      EXPIRED: {
        label: 'Expirado',
        description: 'El pago expiró',
        color: 'secondary',
        icon: 'calendar-x',
      },
    };

    return (statusMap[status] || {
        label: status,
        description: 'Estado desconocido',
        color: 'secondary',
        icon: 'help-circle',
      }
    );
  }
  private formatPaymentMethod(method: string): string {
    const methodMap = {
      CARD: 'Tarjeta de crédito/débito',
      PSE: 'PSE - Pago Seguro en Línea',
      NEQUI: 'Nequi',
      DAVIPLATA: 'DaviPlata',
      CASH: 'Efectivo',
      TRANSFER: 'Transferencia bancaria',
    };

    return methodMap[method] || method;
  }
  async getOrderPaymentAnalytics(orderId: number) {
    const attempts = await this.getOrderPaymentAttempts(orderId);
    if (attempts.length === 0) {
      return null;
    }
    const successfulAttempt = attempts.find(a => a.isSuccessful);
    const attemptsByMethod = attempts.reduce((acc, attempt) => {
      const method = attempt.paymentMethod;
      if (!acc[method]) {
        acc[method] = {
          count: 0,
          successful: 0,
          totalAmount: 0,
        };
      }
      acc[method].count++;
      if (attempt.isSuccessful) {
        acc[method].successful++;
      }
      acc[method].totalAmount += attempt.amount;
      return acc;
    }, {});
    const timeAnalysis = this.analyzeAttemptTimes(attempts);
    return {
      orderId,
      totalAttempts: attempts.length,
      successfulAttempt: successfulAttempt || null,
      attemptsByMethod,
      timeAnalysis,
      recommendations: this.generateRecommendations(attempts),
    };
  }
  private getStockLevel(currentStock: number, minStock: number = 10): {
    level: 'CRITICAL' | 'LOW' | 'NORMAL' | 'HIGH' | 'EXCESS';
    percentage: number;
    message: string;
    color: string;
    icon: string;
  } {
    // Validar parámetros
    if (currentStock < 0) currentStock = 0;
    if (minStock <= 0) minStock = 1; // Valor por defecto seguro
    // Calcular porcentaje basado en stock mínimo
    const percentage = minStock > 0 ? (currentStock / minStock) * 100 : 100;
    // Determinar nivel según rangos
    if (currentStock === 0) {
      return {
        level: 'CRITICAL',
        percentage: 0,
        message: 'Sin stock disponible',
        color: 'danger',
        icon: 'alert-circle',
      };
    } else if (currentStock <= minStock * 0.2) {
      return {
        level: 'CRITICAL',
        percentage: Math.round(percentage),
        message: 'Stock crítico, reponer urgentemente',
        color: 'danger',
        icon: 'alert-triangle',
      };
    } else if (currentStock <= minStock * 0.5) {
      return {
        level: 'LOW',
        percentage: Math.round(percentage),
        message: 'Stock muy bajo',
        color: 'warning',
        icon: 'alert',
      };
    } else if (currentStock <= minStock) {
      return {
        level: 'LOW',
        percentage: Math.round(percentage),
        message: 'Stock bajo, considerar reponer',
        color: 'warning',
        icon: 'trending-down',
      };
    } else if (currentStock <= minStock * 2) {
      return {
        level: 'NORMAL',
        percentage: Math.round(percentage),
        message: 'Stock en niveles normales',
        color: 'success',
        icon: 'check-circle',
      };
    } else if (currentStock <= minStock * 4) {
      return {
        level: 'HIGH',
        percentage: Math.round(percentage),
        message: 'Stock alto',
        color: 'info',
        icon: 'trending-up',
      };
    } else {
      return {
        level: 'EXCESS',
        percentage: Math.round(percentage),
        message: 'Stock excesivo, considerar redistribución',
        color: 'secondary',
        icon: 'package',
      };
    }
  }
  private analyzeAttemptTimes(
    attempts: Array<{ createdAt: Date | string; [key: string]: any }>,
  ) {
    if (attempts.length < 2) {
      return null;
    }
    const sortedAttempts = [...attempts].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const timeDifferences: number[] = [];
    for (let i = 1; i < sortedAttempts.length; i++) {
      const prevTime: number = new Date(
        sortedAttempts[i - 1].createdAt,
      ).getTime();
      const currTime: number = new Date(sortedAttempts[i].createdAt).getTime();
      const diffMinutes: number = Math.round(
        (currTime - prevTime) / (1000 * 60),
      );
      timeDifferences.push(diffMinutes);
    }

    const averageTime = timeDifferences.reduce((a, b) => a + b, 0) / timeDifferences.length;
    const maxTime = Math.max(...timeDifferences);
    const minTime = Math.min(...timeDifferences);

    return {
      timeDifferences,
      averageTimeMinutes: Math.round(averageTime),
      maxTimeMinutes: maxTime,
      minTimeMinutes: minTime,
      totalTimeSpanMinutes: Math.round(
        (new Date(
          sortedAttempts[sortedAttempts.length - 1].createdAt,
        ).getTime() -
          new Date(sortedAttempts[0].createdAt).getTime()) /
          (1000 * 60),
      ),
    };
  }
  private generateRecommendations(attempts: any[]) {
    const recommendations: Array<{
      type: string;
      title: string;
      message: string;
      severity: string;
      action: string;
    }> = [];
    const failedAttempts = attempts.filter((a) => a.isFailed);

    if (failedAttempts.length > 0) {
      const errorCodes = failedAttempts.reduce((acc, attempt) => {
        if (attempt.errorCode) {
          acc[attempt.errorCode] = (acc[attempt.errorCode] || 0) + 1;
        }
        return acc;
      }, {});
      if (errorCodes['card_declined']) {
        recommendations.push({
          type: 'error_analysis',
          title: 'Tarjeta declinada',
          message: 'Múltiples intentos con tarjeta declinada. Sugerir método de pago alternativo.',
          severity: 'high',
          action: 'suggest_alternative_payment',
        });
      }

      if (errorCodes['insufficient_funds']) {
        recommendations.push({
          type: 'error_analysis',
          title: 'Fondos insuficientes',
          message: 'El cliente no tiene fondos suficientes. Considerar opciones de pago a cuotas.',
          severity: 'medium',
          action: 'suggest_installments',
        });
      }
    }

    const successfulIndex = attempts.findIndex(a => a.isSuccessful);
    return recommendations;
  }
  async updateStock(productId: number, dto: UpdateStockDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId, isActive: true },
      select: {
        id: true,
        name: true,
        stock: true,
        minStock: true,
        maxStock: true,
        isAvailable: true,
        lastSoldAt: true,
      },
    });

    if (!product) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado o inactivo`);
    }

    // 2. Validar el ajuste
    const newStock = product.stock + dto.adjustment;
    if (newStock < 0) {
      throw new BadRequestException(
        `No se puede reducir el stock a menos de 0. Stock actual: ${product.stock}, ajuste: ${dto.adjustment}`
      );
    }

    if (product.maxStock && newStock > product.maxStock) {
      throw new BadRequestException(
        `El stock no puede exceder el máximo permitido (${product.maxStock}). ` +
        `Stock resultante: ${newStock}`
      );
    }
    const movementType = dto.type 
    return await this.prisma.$transaction(async (tx) => {
      // Actualizar stock del producto
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          stock: newStock,
          isAvailable: newStock > 0,
          updatedAt: new Date(),
          lastSoldAt: dto.adjustment < 0 ? new Date() : product.lastSoldAt,
        },
        include: {
          stockMovements: {
            take: 5,
            orderBy: { performedAt: 'desc' },
          },
        },
      });
      const movement = await tx.stockMovement.create({
        data: {
          productId,
          type: movementType!,
          quantity: Math.abs(dto.adjustment),
          previousStock: product.stock,
          newStock,
          referenceType: 'ADJUSTMENT',
          reason: dto.reason || 'Ajuste manual de inventario',
          notes: dto.notes,
          performedAt: new Date(),
        },
      });
      const alerts: Array<{ type: string; message: string; severity: string }> = [];
      if (newStock <= product.minStock) {
        alerts.push({
          type: 'LOW_STOCK',
          message: `Producto "${product.name}" tiene stock bajo (${newStock}/${product.minStock})`,
          severity: newStock === 0 ? 'CRITICAL' : 'WARNING',
        });
        if (newStock === 0) {
          await tx.product.update({
            where: { id: productId },
            data: { isAvailable: false },
          });
        }
      }

      // 6. Si se incrementó stock por encima del mínimo, habilitar producto
      if (newStock > 0 && !product.isAvailable) {
        await tx.product.update({
          where: { id: productId },
          data: { isAvailable: true },
        });
      }
      return {
        success: true,
        message: `Stock actualizado de ${product.stock} a ${newStock} (${dto.adjustment > 0 ? '+' : ''}${dto.adjustment})`,
        product: updatedProduct,
        movement,
        previousStock: product.stock,
        newStock,
        adjustment: dto.adjustment,
        alerts,
      };
    });
  }
  async restockProduct(productId: number, dto: RestockDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId, isActive: true },
      select: {
        id: true,
        name: true,
        stock: true,
        minStock: true,
        maxStock: true,
        price: true,
      },
    });

    if (!product) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado o inactivo`);
    }
    const newStock = product.stock + dto.quantity;
    if (product.maxStock && newStock > product.maxStock) {
      throw new BadRequestException(
        `La reposición excede el stock máximo permitido (${product.maxStock}). ` +
        `Stock actual: ${product.stock}, reposición: ${dto.quantity}, resultante: ${newStock}`
      );
    }
    return await this.prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          stock: newStock,
          isAvailable: true,
          lastRestockedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const movement = await tx.stockMovement.create({
        data: {
          productId,
          type: StockMovementType.INCREMENT,
          quantity: dto.quantity,
          previousStock: product.stock,
          newStock,
          referenceType: 'RESTOCK',
          reason: dto.supplier
            ? `Reposición de inventario - Proveedor: ${dto.supplier}`
            : 'Reposición de inventario',
          notes: this.buildRestockNotes(dto),
          performedAt: new Date(),
        },
      });
      const restockRecord = await tx.restockRecord.create({
        data: {
          productId,
          quantity: dto.quantity,
          unitCost: dto.unitCost,
          totalCost: dto.unitCost ? dto.quantity * dto.unitCost : null,
          batchNumber: dto.batchNumber,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          supplier: dto.supplier,
          invoiceNumber: dto.invoiceNumber,
          notes: dto.notes,
          restockedAt: new Date(),
        },
      });
      if (dto.unitCost) {
        await this.updateCostPrice(productId, dto.unitCost, tx);
      }
      const marginInfo = dto.unitCost
        ? this.calculateMargin(product.price, dto.unitCost)
        : null;

      return {
        success: true,
        product: updatedProduct,
        restockRecord,
        movement,
        previousStock: product.stock,
        newStock,
        quantityAdded: dto.quantity,
        marginInfo,
      };
    });
  }
  private buildRestockNotes(dto: RestockDto): string {
    const notes: string[] = [];
    if (dto.supplier) notes.push(`Proveedor: ${dto.supplier}`);
    if (dto.batchNumber) notes.push(`Lote: ${dto.batchNumber}`);
    if (dto.invoiceNumber) notes.push(`Factura: ${dto.invoiceNumber}`);
    if (dto.expiryDate) notes.push(`Vencimiento: ${dto.expiryDate}`);
    if (dto.unitCost) notes.push(`Costo unitario: $${dto.unitCost}`);
    if (dto.notes) notes.push(`Notas: ${dto.notes}`);
    return notes.join(' | ');
  }
  private async updateCostPrice(productId: number, unitCost: number, tx: any) {
    await tx.costHistory.create({
      data: {
        productId,
        cost: unitCost,
        effectiveFrom: new Date(),
      },
    });
  }
  private calculateMargin(sellingPrice: number, costPrice: number) {
    const marginAmount = sellingPrice - costPrice;
    const marginPercentage = (marginAmount / sellingPrice) * 100;
    const markupPercentage = (marginAmount / costPrice) * 100;
    return {
      costPrice,
      sellingPrice,
      marginAmount,
      marginPercentage: Math.round(marginPercentage * 100) / 100,
      markupPercentage: Math.round(markupPercentage * 100) / 100,
      isProfitable: marginAmount > 0,
    };
  }
  async getStockHistory(productId: number, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const history = await this.prisma.stockMovement.findMany({
      where: {
        productId,
        performedAt: {
          gte: startDate,
        },
      },
      orderBy: { performedAt: 'desc' },
      include: {
        product: {
          select: {
            name: true,
            sku: true,
          },
        },
      },
    });
    const stats = history.reduce((acc, movement) => {
      if (movement.type === 'INCREMENT') {
        acc.totalIncoming += movement.quantity;
      } else if (movement.type === 'DECREMENT') {
        acc.totalOutgoing += movement.quantity;
      }
      return acc;
    }, { totalIncoming: 0, totalOutgoing: 0 });
    return {
      history,
      stats,
      period: {
        startDate,
        endDate: new Date(),
        days,
      },
    };
  }
  async getLowStockProducts(threshold?: number) {
    const where: Prisma.ProductWhereInput = {
      isActive: true,
    };

    if (threshold !== undefined) {
      where.stock = { lte: threshold };
    } else {
      where.stock = { lte: { minStock: true } as any };
    }

    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        ...(threshold !== undefined ? { stock: { lte: threshold } }: {}),
      },
      orderBy: { stock: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        stock: true,
        minStock: true,
        maxStock: true,
        price: true,
        lastSoldAt: true,
        lastRestockedAt: true,
      },
    });
    return products.map(product => ({
      ...product,
      stockLevel: this.getStockLevel(product.stock, product.minStock),
      daysSinceLastSale: product.lastSoldAt
        ? Math.floor((Date.now() - product.lastSoldAt.getTime()) / (1000 * 60 * 60 * 24))
        : null,
      suggestedRestock: Math.max(product.minStock * 2 - product.stock, product.minStock),
    }));
  }
  async getUsers(params: GetUsersDto) {
    const {
      page,
      limit,
      role,
      isActive,
      isVerified,
      search,
      email,
      name,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const skip = (page! - 1) * limit!;
    const where: Prisma.UserWhereInput = {
      deletedAt: null, // Solo usuarios no eliminados
    };

    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive;
    if (isVerified !== undefined) where.isVerified = isVerified;
    if (email) where.email = { contains: email, mode: 'insensitive' };
    if (name) where.name = { contains: name, mode: 'insensitive' };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    const orderByField = this.validateUserSortField(sortBy);
    const orderBy: Prisma.UserOrderByWithRelationInput = {
      [orderByField]: sortOrder,
    };

    try {
      const [users, total, statistics] = await Promise.all([
        this.prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          select: this.getUserSelectFields(),
        }),
        this.prisma.user.count({ where }),
        this.getUserStatisticsInternal(),
      ]);
      const transformedUsers = users.map(user => this.transformUser(user));

      return {
        users: transformedUsers,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit!),
        statistics,
      };
    } catch (error) {
      console.error('Error en getUsers:', error);
      throw error;
    }
  }
  private getUserSelectFields(): Prisma.UserSelect {
    return {
      id: true,
      email: true,
      name: true,
      phone: true,
      address: true,
      avatar: true,
      role: true,
      isActive: true,
      isVerified: true,
      emailVerified: true,
      loginAttempts: true,
      lastLogin: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          orders: true,
          refreshTokens: true,
          userActivities: {
            where: {
              action: 'LOGIN',
            },
          },
        },
      },
    };
  }
  private transformUser(user: any) {
    return {
      ...user,
      // Información calculada
      hasOrders: user._count.orders > 0,
      totalOrders: user._count.orders,
      totalLogins: user._count.userActivities,
      lastLoginFormatted: user.lastLogin 
        ? user.lastLogin.toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : null,
      createdAtFormatted: user.createdAt.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      _count: undefined,
    };
  }
  async updateUserRole(userId: number, dto: UpdateUserRoleDto, adminId: number) {
    const user = await this.prisma.user.findUnique({
      where: { 
        id: userId,
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${userId} no encontrado`);
    }
    if (!user.isActive) {
      throw new BadRequestException(
        `No se puede cambiar el rol de un usuario inactivo`
      );
    }
    if (user.role === dto.role) {
      throw new BadRequestException(
        `El usuario ya tiene el rol ${dto.role}`
      );
    }
    this.validateRoleTransition(user.role, dto.role);
    return await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          role: dto.role,
          updatedAt: new Date(),
        },
        select: this.getUserSelectFields(),
      });
      await tx.userRoleHistory.create({
        data: {
          userId,
          previousRole: user.role,
          newRole: dto.role,
          changedBy: adminId,
          reason: dto.reason || 'Cambio de rol administrativo',
          notes: dto.notes,
          changedAt: new Date(),
        },
      });
      await tx.userActivity.create({
        data: {
          userId,
          action: 'ROLE_CHANGED',
          metadata: {
            previousRole: user.role,
            newRole: dto.role,
            changedByAdminId: adminId,
            reason: dto.reason,
          },
          performedAt: new Date(),
        },
      });

      if (dto.role === 'ADMIN' && !updatedUser.emailVerified) {
        await tx.user.update({
          where: { id: userId },
          data: { 
            emailVerified: true,
            isVerified: true,
          },
        });
      }

      return {
        success: true,
        message: `Rol de ${user.email} actualizado de ${user.role} a ${dto.role}`,
        user: this.transformUser(updatedUser),
        previousRole: user.role,
        newRole: dto.role,
        changedBy: adminId,
        changedAt: new Date(),
      };
    });
  }
  private validateRoleTransition(currentRole: Role, newRole: Role) {
    const roleHierarchy = {
      USER: ['MODERATOR', 'SUPPORT'],
      MODERATOR: ['USER', 'SUPPORT'],
      SUPPORT: ['USER', 'MODERATOR', 'ADMIN'],
      ADMIN: ['USER', 'MODERATOR', 'SUPPORT'],
    };
    if (!roleHierarchy[currentRole]?.includes(newRole)) {
      throw new BadRequestException(
        `No se puede cambiar el rol de ${currentRole} a ${newRole}. ` +
        `Transiciones permitidas desde ${currentRole}: ${roleHierarchy[currentRole]?.join(', ')}`
      );
    }

    // Validaciones adicionales
    if (newRole === 'ADMIN') {
      // agregar validaciones adicionales para asignar rol ADMIN
    }
  }
  private validateUserSortField(sortBy: string): string {
    const allowedFields = [
      'createdAt',
      'updatedAt',
      'lastLogin',
      'email',
      'name',
      'role',
      'id',
    ];

    return allowedFields.includes(sortBy) ? sortBy : 'createdAt';
  }
  async getUserStatistics() {
    const [
      totalUsers,
      activeUsers,
      verifiedUsers,
      usersByRole,
      newUsersLast7Days,
      newUsersLast30Days,
      userActivity,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.user.count({ where: { deletedAt: null, isVerified: true } }),
      this.prisma.user.groupBy({
        by: ['role'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.user.count({
        where: {
          deletedAt: null,
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      this.prisma.user.count({
        where: {
          deletedAt: null,
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      this.prisma.userActivity.groupBy({
        by: ['action'],
        where: {
          performedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
        _count: { _all: true },
      }),
    ]);
    const roles = usersByRole.reduce((acc, item) => {
      acc[item.role] = item._count._all;
      return acc;
    }, {});
    const dailyActivity = userActivity.reduce((acc, item) => {
      acc[item.action] = item._count._all;
      return acc;
    }, {});

    return {
      totals: {
        all: totalUsers,
        active: activeUsers,
        verified: verifiedUsers,
        inactive: totalUsers - activeUsers,
        verificationRate: totalUsers > 0 ? (verifiedUsers / totalUsers) * 100 : 0,
      },
      byRole: roles,
      growth: {
        last7Days: newUsersLast7Days,
        last30Days: newUsersLast30Days,
        dailyAverage: newUsersLast30Days / 30,
      },
      activity: {
        last24Hours: dailyActivity,
        totalLogins: dailyActivity['LOGIN'] || 0,
      },
      calculated: {
        activeRate: totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0,
        userGrowthRate: totalUsers > 0 
          ? ((newUsersLast30Days / totalUsers) * 100) 
          : 0,
      },
    };
  }
  private async getUserStatisticsInternal() {
    const [total, byRole, active] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.groupBy({
        by: ['role'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.user.count({ where: { deletedAt: null, isActive: true } }),
    ]);

    return {
      total,
      byRole: byRole.reduce((acc, item) => {
        acc[item.role] = item._count._all;
        return acc;
      }, {}),
      active,
      inactive: total - active,
    };
  }
  async getUserActivity(userId: number, params: { page: number; limit: number }) {
    const userExists = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!userExists) {
      throw new NotFoundException(`Usuario con ID ${userId} no encontrado`);
    }
    const { page, limit } = params;
    const skip = (page - 1) * limit;
    const [activities, total] = await Promise.all([
      this.prisma.userActivity.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { performedAt: 'desc' },
        select: {
          id: true,
          action: true,
          ipAddress: true,
          userAgent: true,
          metadata: true,
          performedAt: true,
        },
      }),
      this.prisma.userActivity.count({ where: { userId } }),
    ]);
    const transformedActivities = activities.map(activity => ({
      ...activity,
      actionLabel: this.getActionLabel(activity.action),
      performedAtFormatted: activity.performedAt.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      isSuspicious: this.isSuspiciousActivity(activity),
    }));

    return {
      activities: transformedActivities,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }
  private getActionLabel(action: string): string {
    const actionLabels = {
      LOGIN: 'Inicio de sesión',
      LOGOUT: 'Cierre de sesión',
      PASSWORD_CHANGE: 'Cambio de contraseña',
      PROFILE_UPDATE: 'Actualización de perfil',
      ORDER_CREATED: 'Orden creada',
      ROLE_CHANGED: 'Rol cambiado',
      USER_LIST_VIEWED: 'Lista de usuarios vista',
      USER_ROLE_CHANGED: 'Rol de usuario cambiado',
    };

    return actionLabels[action] || action;
  }
  private isSuspiciousActivity(activity: any): boolean {
    // Lógica básica para detectar actividad sospechosa
    if (activity.action === 'LOGIN' && activity.ipAddress) {
      // verificar contra una lista de IPs sospechosas
      // o detectar patrones anómalos
      return false; // Implementar lógica real aquí
    }
    return false;
  }
  async logAdminActivity(adminId: number, action: string, metadata?: any) {
    try {
      await this.prisma.userActivity.create({
        data: {
          userId: adminId,
          action,
          metadata,
          performedAt: new Date(),
        },
      });
    } catch (error) {
      console.error('Error registrando actividad de admin:', error);
    }
  }
  async searchUsers(criteria: {
    email?: string;
    name?: string;
    phone?: string;
    role?: Role;
    isActive?: boolean;
  }) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
    };

    if (criteria.email) where.email = { contains: criteria.email, mode: 'insensitive' };
    if (criteria.name) where.name = { contains: criteria.name, mode: 'insensitive' };
    if (criteria.phone) where.phone = { contains: criteria.phone, mode: 'insensitive' };
    if (criteria.role) where.role = criteria.role;
    if (criteria.isActive !== undefined) where.isActive = criteria.isActive;

    const users = await this.prisma.user.findMany({
      where,
      take: 50, // Limitar resultados
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users;
  }
}
