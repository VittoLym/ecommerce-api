import { Injectable, Module } from '@nestjs/common';
import { ProductsRepository } from './products.repository';
@Module({
  imports: [ProductsRepository],
})
@Injectable()
export class ProductsService {
  constructor(private repo: ProductsRepository) {}

  findAll() {
    return this.repo.findAll();
  }
  createProduct() {
    return 'se estan creando';
  }
}
