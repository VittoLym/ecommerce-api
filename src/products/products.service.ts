import { Injectable, Module } from '@nestjs/common';
import { ProductsRepository } from './products.repository';
import { CreateProductDto } from './dto/create.products.dto';
@Module({
  imports: [ProductsRepository],
})
@Injectable()
export class ProductsService {
  constructor(private repo: ProductsRepository) {}

  findAll() {
    return this.repo.findAll();
  }
  findById(id: number) {
    return this.repo.findById(id);
  }
  create(dto: CreateProductDto) {
    return this.repo.create(dto);
  }
}
