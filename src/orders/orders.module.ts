import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './orders.repository';
import { CartService } from 'src/cart/cart.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository, CartService],
  exports: [OrdersRepository],
})
export class OrdersModule {}
