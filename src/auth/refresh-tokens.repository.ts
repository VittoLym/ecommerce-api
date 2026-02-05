import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

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
  async findValid(tokenHash: string) {
    const validTokens = await this.prisma.refreshToken.findMany({
      where: {
        revoked: false,
        expiresAt: { gt: new Date() },
      },
    });
    for (const token of validTokens) {
      const isValid = await bcrypt.compare(tokenHash, token.tokenHash);
      console.log(isValid);
      if (isValid) {
        return token;
      }
    }
    return null;
  }
  revoke(id: number) {
    return this.prisma.refreshToken.update({
      where: { id },
      data: { revoked: true },
    });
  }
  revokeAllByUser(userId: number) {
    return this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revoked: false,
      },
      data: {
        revoked: true,
      },
    });
  }
}
