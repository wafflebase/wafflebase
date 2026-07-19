import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileService } from './file.service';
import { MAX_PDF_UPLOAD_BYTES } from './file.constants';

// Bulk uploads (dropping many files at once) burst past the global 120/min
// default; match the inline-image routes' raised bucket.
const FILE_THROTTLE = { default: { limit: 600, ttl: 60_000 } } as const;

@Controller('files')
@Throttle(FILE_THROTTLE)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  // Cap the upload at the Multer layer so an oversized body is rejected during
  // parsing rather than being fully buffered into memory first.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PDF_UPLOAD_BYTES } }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ id: string }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.fileService.upload(file.buffer, file.mimetype);
  }
}
