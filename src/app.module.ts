import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductsModule } from './products/products.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CartService } from './cart/cart.service';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsService } from './payments/payments.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [ProductsModule, PrismaModule, AuthModule, CartModule, OrdersModule, PaymentsModule],
  controllers: [AppController, PaymentsController],
  providers: [AppService, CartService, PaymentsService],
})
export class AppModule {}
