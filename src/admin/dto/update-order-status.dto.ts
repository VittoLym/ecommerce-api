import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus, {
    message: 'Estado inválido. Los valores válidos son: PENDING, PROCESSING, PAID, SHIPPED, DELIVERED, CANCELLED, REFUNDED',
  })
  status: OrderStatus;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
