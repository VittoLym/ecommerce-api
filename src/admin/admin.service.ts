import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrderStatus, Prisma } from '@prisma/client';

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
          // Si tienes envíos/shipping
          shipping: {
            select: {
              id: true,
              address: true,
              status: true,
              trackingNumber: true,
              estimatedDelivery: true,
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

  async changeStatusOrder(id: number) {
    await this.prisma.order.findMany();
    console.log(id);
  }
}
