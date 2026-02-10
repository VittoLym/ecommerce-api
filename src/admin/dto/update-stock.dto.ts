import { IsInt, Min, IsOptional, IsString, IsEnum, IsPositive, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockMovementType } from '@prisma/client';

export class UpdateStockDto {
  @ApiProperty({
    description: 'Cantidad a ajustar (positivo para incrementar, negativo para disminuir)',
    example: 10,
  })
  @IsInt()
  @Type(() => Number)
  adjustment: number;

  @ApiPropertyOptional({
    description: 'Razón del ajuste de stock',
    example: 'Corrección de inventario físico',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Notas adicionales',
    example: 'Se encontraron diferencias en el conteo físico',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    enum: StockMovementType,
    description: 'Tipo de movimiento (se infiere automáticamente si no se especifica)',
  })
  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;
}
