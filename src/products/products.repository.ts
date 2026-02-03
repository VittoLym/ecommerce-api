import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Product } from '@prisma/client';

@Injectable()
export class ProductsRepository {
  constructor(private prisma: PrismaService) {}

  findAll(): Promise<Product[]> {
    return this.prisma.client.product.findMany();
  }

  findById(id: number): Promise<Product | null> {
    return this.prisma.client.product.findUnique({
      where: { id },
    });
  }

  create(data: Omit<Product, 'id'>): Promise<Product> {
    return this.prisma.client.product.create({ data });
  }
}
