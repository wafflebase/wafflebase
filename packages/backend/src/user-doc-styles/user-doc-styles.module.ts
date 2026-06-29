import { Module } from '@nestjs/common';
import { UserDocStylesController } from './user-doc-styles.controller';
import { UserDocStylesService } from './user-doc-styles.service';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  controllers: [UserDocStylesController],
  providers: [UserDocStylesService, PrismaService],
  exports: [UserDocStylesService],
})
export class UserDocStylesModule {}
