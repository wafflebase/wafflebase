import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async createToken(user: User) {
    const payload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      photo: user.photo,
    };

    return {
      token: this.jwtService.sign(payload),
    };
  }
}
