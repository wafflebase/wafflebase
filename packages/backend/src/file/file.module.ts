import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { fileConfig } from './file.config';
import { FileService } from './file.service';
import { FileController } from './file.controller';

@Module({
  imports: [ConfigModule.forFeature(fileConfig)],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
