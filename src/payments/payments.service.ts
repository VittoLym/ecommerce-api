import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrdersRepository } from 'src/orders/orders.repository';
import { PaymentAttemptRepository } from './paymentsAttempts.repository';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private ordersRepo: OrdersRepository,
    private attemptsRepo: PaymentAttemptRepository,
  ) {}

  async pay(orderId: number, userId: number) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
      });
      if (!order) {
        throw new NotFoundException('Orden no encontrada');
      }
      if (order.userId !== userId) {
        throw new ForbiddenException('No es tu orden');
      }
      if (order.status !== 'PENDING') {
        throw new BadRequestException('La orden no puede pagarse');
      }
      await new Promise((res) => setTimeout(res, 500));
      const success = Math.random() > 0.3;
      if (!success) {
        throw new Error('Pago rechazado');
      }
      const attempt = await this.prisma.paymentAttempt.create({
        data: {
          orderId,
          userId,
          amount: order.total,
          provider: 'mock',
          status: success ? 'SUCCESS' : 'FAILED',
          errorMessage: success ? null : 'Tarjeta rechazada',
        },
      });
      return this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'PAID' },
      });
    } catch (e) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'FAILED' },
      });

      throw new BadRequestException('Pago fallido');
    }
  }
  async payWithRetry(orderId: number, userId: number) {
    const order = await this.ordersRepo.findPending(orderId, userId);

    const failedCount = await this.attemptsRepo.countFailed(orderId);
    if (failedCount >= 3) {
      throw new BadRequestException('Máximo de intentos alcanzado');
    }

    const last = await this.attemptsRepo.lastAttempt(orderId);
    if (last && !last.retryable) {
      throw new BadRequestException('Pago no reintentable');
    }

    const success = Math.random() > 0.5;
    const amount = order.total;
    if (!success) {
      const errorCode =
        Math.random() > 0.5 ? 'card_declined' : 'insufficient_funds';

      const retryable = !['insufficient_funds'].includes(errorCode);
      await this.attemptsRepo.create(
        orderId,
        userId,
        amount,
        'FAILED',
        'mock',
        retryable,
        errorCode,
      );

      await this.ordersRepo.updateStatus(orderId, 'FAILED');

      throw new BadRequestException(`Pago fallido: ${errorCode}`);
    }

    await this.attemptsRepo.create(
      orderId,
      userId,
      amount,
      'SUCCESS',
      'mock',
      false,
      '',
    );

    return this.ordersRepo.updateStatus(orderId, 'PAID');
  }
}
