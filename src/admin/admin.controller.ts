import {
  UseGuards,
  Controller,
  ParseIntPipe,
  Param,
  Req,
  NotFoundException,
  Get,
  Patch,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RolesGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('orders')
  async findAllOrders(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('status') status?: string,
  ) {
    try {
      const orders = await this.adminService.findAllOrders({
        page,
        limit,
        status,
      });
      return {
        success: true,
        data: orders,
        page,
        limit,
      };
    } catch (error) {
      throw new HttpException(
        'Error al obtener órdenes',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('orders/:id')
  async findOrder(@Param('id', ParseIntPipe) id: number) {
    try {
      const order = await this.adminService.findOrder(id);
      if (!order) {
        throw new NotFoundException(`Orden con ID ${id} no encontrada`);
      }
      return {
        success: true,
        data: order,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error(`Error obteniendo orden ${id}:`, error);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener la orden',
          error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch('orders/:id/status')
  async changeStatusOrder(@Param('id', ParseIntPipe) id: number) {
    return await this.adminService.changeStatusOrder(id);
  }
}
