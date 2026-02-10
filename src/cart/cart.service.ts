import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CartService {
  constructor(private prisma: PrismaService) {}

  async getOrCreateCart(userId: number) {
    let cart = await this.prisma.cart.findFirst({
      where: { userId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { userId },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });
    }

    const totalPrice = cart.items.reduce(
      (acc, item) => acc + item.product.price * item.quantity,
      0,
    );

    return {
      ...cart,
      totalPrice,
    };
  }

  async addItem(userId: number, productId: number, qty: number) {
    const cart = await this.getOrCreateCart(userId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId },
    });
    if (product!.stock < qty) {
      throw new BadRequestException('Stock insuficiente');
    }
    return this.prisma.cartItem.upsert({
      where: {
        id: cart.id,
        productId,
      },
      create: {
        cartId: cart.id,
        productId,
        quantity: qty,
      },
      update: {
        quantity: { increment: qty },
      },
    });
  }

  async removeItem(userId: number, productId: number) {
    const cart = await this.getOrCreateCart(userId);

    return this.prisma.cartItem.delete({
      where: {
        id: cart.id,
        productId,
      },
    });
  }

  async clearCart(userId: number) {
    const cart = await this.getOrCreateCart(userId);
    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });
    return this.prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });
  }

  async checkout(userId: number) {
    return this.prisma.$transaction(async (tx) => {
      const items = await tx.cartItem.findMany({
        where: { cartId: userId },
        include: { product: true },
      });

      for (const item of items) {
        if (item.product.stock < item.quantity) {
          throw new BadRequestException('No stock');
        }

        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { decrement: item.quantity },
          },
        });
      }

      const order = await tx.order.create({
        data: {
          userId,
          total: items.reduce(
            (sum, i) => sum + i.quantity * i.product.price,
            0,
          ),
        },
      });

      await tx.cartItem.deleteMany({
        where: { cartId: userId },
      });

      return order;
    });
  }
}
