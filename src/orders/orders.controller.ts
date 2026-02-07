import {
  Controller,
  UseGuards,
  Req,
  Get,
  Post,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OrdersService } from './orders.service';
import { RolesGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/roles.decorator';

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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post(':orderId/refund')
  refund(@Req() req, @Param('orderId', ParseIntPipe) orderId: number) {
    return this.ordersService.refund(orderId, req.user.userId)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post()
  findAllOrder() {
    return this.ordersService.findAllUser();
  }
}
