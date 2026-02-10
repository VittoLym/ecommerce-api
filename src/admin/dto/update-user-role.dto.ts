import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class UpdateUserRoleDto {
  @ApiProperty({
    enum: Role,
    description: 'Nuevo rol del usuario',
    example: 'ADMIN',
  })
  @IsEnum(Role, {
    message: `Rol inválido. Roles válidos: ${Object.values(Role).join(', ')}`,
  })
  role: Role;

  @ApiPropertyOptional({
    description: 'Razón del cambio de rol',
    example: 'Promoción a administrador',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Notas adicionales sobre el cambio',
    example: 'Usuario demostró responsabilidad y conocimiento del sistema',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
