import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class UserDocStylesService {
  constructor(private prisma: PrismaService) {}

  async get(userId: number): Promise<unknown> {
    const row = await this.prisma.userDocStyles.findUnique({
      where: { userId },
    });
    return row?.styles ?? {};
  }

  async upsert(userId: number, styles: unknown): Promise<void> {
    const value = styles as Prisma.InputJsonValue;
    await this.prisma.userDocStyles.upsert({
      where: { userId },
      create: { userId, styles: value },
      update: { styles: value },
    });
  }
}
