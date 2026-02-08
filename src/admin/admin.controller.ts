import {
  UseGuards,
  Controller,
  ParseIntPipe,
  Param,
  Body,
  UsePipes,
  ValidationPipe,
  DefaultValuePipe,
  BadRequestException,
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
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
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
  @UsePipes(new ValidationPipe({ transform: true }))
  async changeStatusOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrderStatusDto: UpdateOrderStatusDto,
  ) {
    try {
      if (!updateOrderStatusDto.status) {
        throw new BadRequestException('El campo status es requerido');
      }

      const result = await this.adminService.changeStatusOrder(
        id,
        updateOrderStatusDto,
      );

      if (!result.success) {
        throw new BadRequestException(result.message);
      }

      return {
        success: true,
        message: 'Estado de orden actualizado exitosamente',
        data: {
          order: result.order,
          previousStatus: result.previousStatus,
          newStatus: result.newStatus,
        },
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      console.error(`Error cambiando estado de orden ${id}:`, error);

      throw new HttpException(
        {
          success: false,
          message: 'Error al cambiar el estado de la orden',
          error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('payments')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAllPayments(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
    @Query('status') status?,
    @Query('method') method?: PaymentMethodData,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('userId') userId?: number,
    @Query('orderId') orderId?: number,
    @Query('transactionId') transactionId?: string,
    @Query('sortBy', new DefaultValuePipe('createdAt'))
    sortBy: string = 'createdAt',
    @Query('sortOrder', new DefaultValuePipe('desc'))
    sortOrder: 'asc' | 'desc' = 'desc',
  ) {
    try {
      const result = await this.adminService.findAllPayments({
        page,
        limit,
        status,
        startDate,
        endDate,
        userId,
        orderId,
        transactionId,
        sortBy,
        sortOrder,
      });

      return {
        success: true,
        data: result.payments,
        meta: {
          total: result.total,
          totalAmount: result.totalAmount,
          page: result.page,
          limit: result.limit,
          pages: result.pages,
          summary: result.summary,
        },
      };
    } catch (error) {
      console.error('Error en findAllPayments:', error);

      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener pagos',
          error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
