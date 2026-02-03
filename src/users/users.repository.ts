import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }
  findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }
  create(data: { email: string; password: string }) {
    return this.prisma.user.create({ data });
  }
}
