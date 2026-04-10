import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImageService } from './image.service';
import type { Response } from 'express';

@Controller('images')
export class ImageController {
  constructor(private readonly imageService: ImageService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ id: string; url: string }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.imageService.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
    );
  }

  @Get(':id')
  async get(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { body, contentType } = await this.imageService.getObject(id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(Buffer.from(body));
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    await this.imageService.delete(id);
    return { deleted: true };
  }
}
