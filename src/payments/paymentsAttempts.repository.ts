import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentAttemptRepository {
  constructor(private prisma: PrismaService) {}

  async create(
    orderId: number,
    amount: number,
    userId: number,
    status: 'PENDING' | 'SUCCESS' | 'FAILED' = 'PENDING',
    provider = 'mock',
    retryable: boolean,
    errorCode?: string,
  ) {
    return await this.prisma.paymentAttempt.create({
      data: {
        orderId,
        userId,
        amount,
        status,
        provider,
        retryable,
        errorCode,
      },
    });
  }

  async findByOrder(orderId: number) {
    return await this.prisma.paymentAttempt.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findLast(orderId: number) {
    return await this.prisma.paymentAttempt.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countFailed(orderId: number) {
    return await this.prisma.paymentAttempt.count({
      where: {
        orderId,
        status: 'FAILED',
      },
    });
  }

  async markSuccess(attemptId: number) {
    return await this.prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: { status: 'SUCCESS' },
    });
  }

  async markFailed(attemptId: number, errorCode?: string) {
    return await this.prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'FAILED',
        errorCode,
      },
    });
  }

  async lastAttempt(orderId: number) {
    return await this.prisma.paymentAttempt.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
