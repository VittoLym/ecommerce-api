import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [AuthModule], // 🔴 ESTO ES CLAVE
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
