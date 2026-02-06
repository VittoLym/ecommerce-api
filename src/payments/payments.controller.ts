import { Controller, UseGuards, Post, Req, Body } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { PaymentsService } from './payments.service';

@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('pay')
  pay(@Req() req, @Body('orderId') orderId: number) {
    return this.paymentsService.pay(orderId, req.user.userId);
  }
}
