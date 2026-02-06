import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

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
}
