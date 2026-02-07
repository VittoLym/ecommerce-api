import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CartService } from 'src/cart/cart.service';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private cartService: CartService,
  ) {}
  async checkout(userId: number) {
    return this.prisma.$transaction(async (tx) => {
      const cart = await this.cartService.getOrCreateCart(userId);
      const items = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        include: { product: true },
      });

      if (items.length === 0) {
        throw new Error('Cart is empty');
      }
      for (const item of items) {
        if (item.product.stock < item.quantity) {
          throw new Error(
            `Insufficient stock for product ${item.product.name}`,
          );
        }
      }
      const order = await tx.order.create({
        data: {
          userId,
          status: 'PENDING',
          total: items.reduce(
            (sum, i) => sum + i.quantity * i.product.price,
            0,
          ),
        },
      });
      await tx.orderItem.createMany({
        data: items.map((i) => ({
          orderId: order.id,
          productId: i.productId,
          quantity: i.quantity,
          price: i.product.price,
        })),
      });
      for (const item of items) {
        const updated = await tx.product.updateMany({
          where: {
            id: item.productId,
            stock: { gte: item.quantity },
          },
          data: {
            stock: { decrement: item.quantity },
          },
        });
        if (updated.count === 0) {
          throw new Error('Stock race condition detected');
        }
      }
      await tx.paymentAttempt.create({
        data: {
          orderId: order.id,
          userId,
          amount: order.total,
          status: 'PENDING',
          provider: 'mock',
        },
      });
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });
      return order;
    });
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
        payment: true,
      },
    });
  }
  async refund(orderId: number, userId: number) {
    const order = await this.getPaidOrder(orderId);
    return this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.create({
        data: {
          orderId,
          userId: order!.userId,
          amount: -order!.total,
          provider: 'mock',
          status: 'REFUNDED',
        },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'REFUNDED' },
      });
      if (order === null) return;
      console.log(order);
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
