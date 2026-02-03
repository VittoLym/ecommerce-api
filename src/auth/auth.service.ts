import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersRepository } from '../users/users.repository';
import 'dotenv/config';

@Injectable()
export class AuthService {
  constructor(
    private usersRepo: UsersRepository,
    private jwt: JwtService,
  ) {}

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
      secretKey: process.env.JWT_SECRET,
    };
    return {
      accessToken: this.jwt.sign(payload),
    };
  }
}
