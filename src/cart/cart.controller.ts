import {
  Controller,
  UseGuards,
  Get,
  Post,
  Delete,
  Req,
  Body,
  Param,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CartService } from './cart.service';

@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private cartService: CartService) {}

  @Get()
  getCart(@Req() req) {
    return this.cartService.getOrCreateCart(req.user.userId);
  }

  @Post('add')
  add(@Req() req, @Body() dto: { productId: number; qty: number }) {
    return this.cartService.addItem(req.user.userId, dto.productId, dto.qty);
  }

  @Delete(':productId')
  remove(@Req() req, @Param('productId') productId: string) {
    return this.cartService.removeItem(req.user.userId, +productId);
  }
  @Delete('clear')
  clear(@Req() req) {
    return this.cartService.clearCart(req.user.userId);
  }
}
