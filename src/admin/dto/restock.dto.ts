import { IsInt, Min, IsOptional, IsString, IsPositive, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RestockDto {
  @ApiProperty({
    description: 'Cantidad a reponer',
    example: 50,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @ApiPropertyOptional({
    description: 'Costo unitario del producto (para valorización de inventario)',
    example: 15000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitCost?: number;

  @ApiPropertyOptional({
    description: 'Número de lote o serie',
    example: 'LOTE-2024-001',
  })
  @IsOptional()
  @IsString()
  batchNumber?: string;

  @ApiPropertyOptional({
    description: 'Fecha de vencimiento (ISO string)',
    example: '2024-12-31',
  })
  @IsOptional()
  @IsString()
  expiryDate?: string;

  @ApiPropertyOptional({
    description: 'Proveedor',
    example: 'Distribuidora XYZ',
  })
  @IsOptional()
  @IsString()
  supplier?: string;

  @ApiPropertyOptional({
    description: 'Número de factura del proveedor',
    example: 'FACT-001-2024',
  })
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiPropertyOptional({
    description: 'Notas adicionales sobre el restock',
    example: 'Producto importado, llegó con retraso por aduana',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
