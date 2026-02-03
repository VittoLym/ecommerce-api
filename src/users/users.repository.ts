import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.client.user.findUnique({ where: { email } });
  }

  create(data: { email: string; password: string }) {
    return this.prisma.client.user.create({ data });
  }
}
