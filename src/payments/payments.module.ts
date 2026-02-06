import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentAttemptRepository } from './paymentsAttempts.repository';
import { OrdersRepository } from 'src/orders/orders.repository';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OrdersModule } from 'src/orders/orders.module';

@Module({
  imports: [PrismaModule, OrdersModule],
  providers: [PaymentsService, PaymentAttemptRepository, OrdersRepository],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
