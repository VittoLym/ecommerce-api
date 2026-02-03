import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { tokenHash: string; userId: number; expiresAt: Date }) {
    return this.prisma.refreshToken.create({ data });
  }

  findValidByUser(userId: number) {
    return this.prisma.refreshToken.findMany({
      where: {
        userId,
        revoked: false,
        expiresAt: { gt: new Date() },
      },
    });
  }

  findAllValid() {
    return this.prisma.refreshToken.findMany({
      where: {
        revoked: false,
        expiresAt: { gt: new Date() },
      },
    });
  }

  revoke(id: number) {
    return this.prisma.refreshToken.update({
      where: { id },
      data: { revoked: true },
    });
  }
}
