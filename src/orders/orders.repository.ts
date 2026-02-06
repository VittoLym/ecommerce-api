import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersRepository {
  constructor(private prisma: PrismaService) {}

  async createFromCart(userId: number, items: any[], total: number) {
    return this.prisma.order.create({
      data: {
        userId,
        total,
        status: 'PENDING',
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.product.price,
          })),
        },
      },
      include: { items: true },
    });
  }
  async findById(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) throw new NotFoundException('Order no encontrada');
    return order;
  }

  async findPending(orderId: number, userId: number) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
        status: 'PENDING',
      },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Order no válida o no pendiente');
    }

    return order;
  }

  async findByUser(userId: number) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  async updateStatus(
    orderId: number,
    status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED',
  ) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status },
    });
  }

  async markAsPaid(orderId: number) {
    return this.updateStatus(orderId, 'PAID');
  }

  async markAsFailed(orderId: number) {
    return this.updateStatus(orderId, 'FAILED');
  }

  async markAsRefunded(orderId: number) {
    return this.updateStatus(orderId, 'REFUNDED');
  }
}
