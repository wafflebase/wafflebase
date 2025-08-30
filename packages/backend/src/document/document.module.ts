import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { UserService } from 'src/user/user.service';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  imports: [],
  controllers: [DocumentController],
  providers: [DocumentService, UserService, PrismaService],
})
export class DocumentModule {}
