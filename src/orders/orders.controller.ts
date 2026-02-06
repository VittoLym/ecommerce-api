import { Controller, UseGuards, Req, Get, Post, Param } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OrdersService } from './orders.service';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post('checkout')
  checkout(@Req() req) {
    return this.ordersService.checkout(req.user.userId);
  }

  @Get()
  findMyOrders(@Req() req) {
    return this.ordersService.findByUser(req.user.userId);
  }
  @Post(':orderId/refund')
  refund(@Req() req, @Param('orderId') orderId: number) {
    return this.ordersService.refund(orderId, req.user.userId)
  }
}
