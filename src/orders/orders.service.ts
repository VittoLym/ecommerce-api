import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}
  async checkout(userId: number) {
    return this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: { userId },
        include: { items: { include: { product: true } } },
      });
      if (!cart || cart.items.length === 0) {
        throw new BadRequestException('Carrito vacío');
      }
      for (const item of cart.items) {
        if (item.product.stock < item.quantity) {
          throw new BadRequestException(
            `Stock insuficiente para ${item.product.name}`,
          );
        }
      }
      const total = cart.items.reduce(
        (sum, item) => sum + item.product.price * item.quantity,
        0,
      );
      const order = await tx.order.create({
        data: {
          userId,
          total,
          items: {
            create: cart.items.map((item) => ({
              productId: item.productId,
              price: item.product.price,
              quantity: item.quantity,
            })),
          },
        },
        include: { items: true },
      });
      for (const item of cart.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }
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
  async refund(orderId: number, userId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException();
    if (order.status !== 'PAID') {
      throw new BadRequestException('No se puede devolver');
    }
    await new Promise((res) => setTimeout(res, 300));
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'REFUNDED' },
    });
  }
}
