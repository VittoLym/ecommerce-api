import {
  Controller,
  UseGuards,
  Req,
  Get,
  Body,
  Post,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { OrdersService } from './orders.service';
import { RolesGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/roles.decorator';
import { CheckoutDto } from './dto/checkout.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Procesar checkout y crear orden' })
  @ApiResponse({ status: 201, description: 'Orden creada exitosamente' })
  @ApiResponse({ status: 400, description: 'Carrito vacío o datos inválidos' })
  @ApiResponse({ status: 409, description: 'Stock insuficiente' })
  async checkout(@Req() req, @Body() checkoutDto: CheckoutDto) {
    const userId = req.user.userId;
    return this.ordersService.checkout(userId, checkoutDto);
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
