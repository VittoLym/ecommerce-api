import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersRepository } from '../users/users.repository';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import 'dotenv/config';

@Injectable()
export class AuthService {
  constructor(
    private usersRepo: UsersRepository,
    private refreshRepo: RefreshTokensRepository,
    private jwt: JwtService,
  ) {}
  private generateAccessToken(payload: object) {
    return this.jwt.sign({
      payload,
      options: {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
      },
    });
  }

  private generateRefreshToken(payload: object) {
    return this.jwt.sign({
      payload: { ...payload, tokenType: 'refresh' },
      options: {
        secret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      },
    });
  }
  async register(email: string, password: string) {
    const hashed = await bcrypt.hash(password, 10);
    const user = await this.usersRepo.create({
      email,
      password: hashed,
    });
    return { id: user.id, email: user.email };
  }

  async login(email: string, password: string) {
    const user = await this.usersRepo.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
    const access_token = this.generateAccessToken(payload);
    const refresh_token = this.generateRefreshToken(payload);
    await this.refreshRepo.create({
      tokenHash: await bcrypt.hash(refresh_token, 10),
      userId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    });
    return {
      access_token,
      refresh_token,
    };
  }
  async refresh(refreshToken: string) {
    const tokens = await this.refreshRepo.findAllValid();
    for (const stored of tokens) {
      const match = await bcrypt.compare(refreshToken, stored.tokenHash);
      if (!match) continue;
      await this.refreshRepo.revoke(stored.id);
      const user = await this.usersRepo.findById(stored.userId);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      const newAccessToken = this.generateAccessToken(user);
      const newRefreshToken = this.generateRefreshToken(user);
      await this.refreshRepo.create({
        tokenHash: await bcrypt.hash(newRefreshToken, 10),
        userId: user.id,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      });
      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    }
    throw new UnauthorizedException();
  }
  async logout(refreshToken: string) {
    const tokens = await this.refreshRepo.findAllValid();
    for (const stored of tokens) {
      const match = await bcrypt.compare(refreshToken, stored.tokenHash);
      if (!match) continue;
      const rev = await this.refreshRepo.revoke(stored.id);
      if (!rev) {
        throw new UnauthorizedException('User not found');
      }
      return {
        userId: rev.userId,
        id: rev.id,
        message: 'Token Revoked',
      };
    }
  }
}
