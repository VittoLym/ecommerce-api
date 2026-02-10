import {
  UseGuards,
  Controller,
  ParseIntPipe,
  Param,
  Body,
  Post,
  UsePipes,
  ValidationPipe,
  DefaultValuePipe,
  BadRequestException,
  NotFoundException,
  Get,
  Req,
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
import { UpdateStockDto } from './dto/update-stock.dto';
import { RestockDto } from './dto/restock.dto';
import { GetUsersDto } from './dto/get-users.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

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
  @Get('orders/:id/attempts')
  async getOrderPaymentAttempts(@Param('id', ParseIntPipe) orderId: number) {
    try {
      const orderExists = await this.adminService.orderExists(orderId);
      if (!orderExists) {
        throw new NotFoundException(`Orden con ID ${orderId} no encontrada`);
      }
      const attempts = await this.adminService.getOrderPaymentAttempts(orderId);
      return {
        success: true,
        data: {
          orderId,
          attempts,
          summary: this.generateAttemptsSummary(attempts),
        },
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error(
        `Error obteniendo intentos de pago para orden ${orderId}:`,
        error,
      );
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener los intentos de pago de la orden',
          error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  private generateAttemptsSummary(attempts: any[]) {
    if (attempts.length === 0) {
      return {
        totalAttempts: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        pendingAttempts: 0,
        successRate: 0,
        lastAttemptStatus: null,
        totalAmountAttempted: 0,
        totalAmountCaptured: 0,
      };
    }

    const successful = attempts.filter((a) => a.status === 'COMPLETED');
    const failed = attempts.filter((a) => a.status === 'FAILED');
    const pending = attempts.filter((a) => a.status === 'PENDING');
    const totalAmountAttempted = attempts.reduce((sum, a) => sum + a.amount, 0);
    const totalAmountCaptured = successful.reduce((sum, a) => sum + a.amount, 0);

    return {
      totalAttempts: attempts.length,
      successfulAttempts: successful.length,
      failedAttempts: failed.length,
      pendingAttempts: pending.length,
      successRate:
        attempts.length > 0 ? (successful.length / attempts.length) * 100 : 0,
      lastAttemptStatus: attempts[0]?.status, // Asumiendo orden descendente
      lastAttemptDate: attempts[0]?.createdAt,
      totalAmountAttempted,
      totalAmountCaptured,
      difference: totalAmountAttempted - totalAmountCaptured,
    };
  }

  @Patch('products/:id/stock')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateStock(
    @Param('id', ParseIntPipe) productId: number,
    @Body() updateStockDto: UpdateStockDto,
  ) {
    try {
      // Validación adicional
      if (updateStockDto.adjustment === 0) {
        throw new BadRequestException('El ajuste no puede ser 0');
      }

      const result = await this.adminService.updateStock(
        productId,
        updateStockDto,
      );

      if (!result.success) {
        throw new BadRequestException(result.message);
      }

      return {
        success: true,
        message: result.message,
        data: {
          product: result.product,
          movement: result.movement,
          stockInfo: {
            previousStock: result.previousStock,
            newStock: result.newStock,
            adjustment: result.adjustment,
            stockLevel: this.getStockLevel(result.newStock, result.product.minStock),
          },
        },
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      console.error(`Error actualizando stock del producto ${productId}:`, error);

      throw new HttpException(
        {
          success: false,
          message: 'Error al actualizar el stock',
          error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('products/:id/restock')
  @UsePipes(new ValidationPipe({ transform: true }))
  async restockProduct(
    @Param('id', ParseIntPipe) productId: number,
    @Body() restockDto: RestockDto,
  ) {
    try {
      const result = await this.adminService.restockProduct(
        productId,
        restockDto,
      );

      return {
        success: true,
        message: 'Producto repuesto exitosamente',
        data: {
          product: result.product,
          restock: result.restockRecord,
          stockInfo: {
            previousStock: result.previousStock,
            newStock: result.newStock,
            quantityAdded: restockDto.quantity,
            totalValue: restockDto.unitCost 
              ? restockDto.quantity * restockDto.unitCost 
              : null,
          },
        },
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      console.error(`Error reponiendo stock del producto ${productId}:`, error);

      throw new HttpException(
        {
          success: false,
          message: 'Error al reponer el stock',
          error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  private getStockLevel(currentStock: number, minStock: number = 10): {
    level: 'CRITICAL' | 'LOW' | 'NORMAL' | 'HIGH' | 'EXCESS';
    percentage: number;
    message: string;
  } {
    const percentage = (currentStock / minStock) * 100;
    if (currentStock <= 0) {
      return {
        level: 'CRITICAL',
        percentage: 0,
        message: 'Sin stock disponible',
      };
    } else if (currentStock <= minStock * 0.3) {
      return {
        level: 'CRITICAL',
        percentage,
        message: 'Stock crítico, reponer urgentemente',
      };
    } else if (currentStock <= minStock) {
      return {
        level: 'LOW',
        percentage,
        message: 'Stock bajo, considerar reponer',
      };
    } else if (currentStock <= minStock * 2) {
      return {
        level: 'NORMAL',
        percentage,
        message: 'Stock en niveles normales',
      };
    } else if (currentStock <= minStock * 5) {
      return {
        level: 'HIGH',
        percentage,
        message: 'Stock alto',
      };
    } else {
      return {
        level: 'EXCESS',
        percentage,
        message: 'Stock excesivo, considerar redistribución',
      };
    }
  }

  @Get('users')
  @UsePipes(new ValidationPipe({ transform: true }))
  async getUsers(
    @Query() queryParams: GetUsersDto,
    @Req() req,
  ) {
    try {
      const result = await this.adminService.getUsers(queryParams);
      await this.adminService.logAdminActivity(
        req.user.userId,
        'USER_LIST_VIEWED',
        {
          filters: queryParams,
          resultCount: result.total,
        },
      );
      return {
        success: true,
        data: {
          users: result.users,
          statistics: result.statistics,
        },
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          pages: result.pages,
        },
      };
    } catch (error) {
      console.error('Error obteniendo usuarios:', error);

      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener usuarios',
          error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  @Patch('users/:id/role')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateUserRole(
    @Param('id', ParseIntPipe) userId: number,
    @Body() updateUserRoleDto: UpdateUserRoleDto,
    @Req() req,
  ) {
    try {
      // Validación adicional
      if (userId === req.user.userId) {
        throw new BadRequestException('No puedes cambiar tu propio rol');
      }

      const result = await this.adminService.updateUserRole(
        userId,
        updateUserRoleDto,
        req.user.userId, // ID del admin que realiza el cambio
      );

      if (!result.success) {
        throw new BadRequestException(result.message);
      }
      await this.adminService.logAdminActivity(
        req.user.userId,
        'USER_ROLE_CHANGED',
        {
          targetUserId: userId,
          previousRole: result.previousRole,
          newRole: result.newRole,
          reason: updateUserRoleDto.reason,
        },
      );

      return {
        success: true,
        message: `Rol de usuario actualizado exitosamente`,
        data: {
          user: result.user,
          roleChange: {
            previousRole: result.previousRole,
            newRole: result.newRole,
            changedBy: result.changedBy,
            changedAt: result.changedAt,
            reason: updateUserRoleDto.reason,
          },
        },
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      console.error(`Error actualizando rol del usuario ${userId}:`, error);

      throw new HttpException(
        {
          success: false,
          message: 'Error al actualizar el rol del usuario',
          error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  @Get('users/statistics')
  async getUserStatistics() {
    try {
      const statistics = await this.adminService.getUserStatistics();
      return {
        success: true,
        data: statistics,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error obteniendo estadísticas de usuarios:', error);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener estadísticas de usuarios',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  @Get('users/:id/activity')
  async getUserActivity(
    @Param('id', ParseIntPipe) userId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50,
  ) {
    try {
      const activity = await this.adminService.getUserActivity(userId, { page, limit });
      return {
        success: true,
        data: activity,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error(`Error obteniendo actividad del usuario ${userId}:`, error);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener actividad del usuario',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
