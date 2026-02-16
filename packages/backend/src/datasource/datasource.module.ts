import { Module } from '@nestjs/common';
import { DataSourceController } from './datasource.controller';
import { DataSourceService } from './datasource.service';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  controllers: [DataSourceController],
  providers: [DataSourceService, PrismaService],
})
export class DataSourceModule {}
