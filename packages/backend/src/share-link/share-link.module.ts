import { Module } from '@nestjs/common';
import { ShareLinkController } from './share-link.controller';
import { ShareLinkService } from './share-link.service';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  controllers: [ShareLinkController],
  providers: [ShareLinkService, PrismaService],
  exports: [ShareLinkService],
})
export class ShareLinkModule {}
