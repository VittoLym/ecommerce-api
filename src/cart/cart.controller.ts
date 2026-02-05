import { Controller, UseGuards, Get, Post, Delete, Req } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CartService } from './cart.service';

@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private cartService: CartService) {}

  @Get()
  getCart(@Req() req) {
    return this.cartService.getOrCreateCart(req.user.id);
  }

  @Post('add')
  add(@Req() req,@Body() dto: { productId: number; qty: number }) {
    return this.cartService.addItem(req.user.id, dto.productId, dto.qty);
  }

  @Delete(':productId')
  remove(@Req() req, @Param('productId') productId: string) {
    return this.cartService.removeItem(req.user.id, +productId);
  }
}
