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
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImageService } from './image.service';
import { VALID_IMAGE_ID_PATTERN } from './image.constants';
import type { Response } from 'express';

// Higher ceiling: opening a doc with many embedded images bursts >60/min.
const IMAGE_THROTTLE = { default: { limit: 600, ttl: 60_000 } } as const;

/**
 * Response Content-Type derived from the id's own extension, never echoed
 * from whatever content type is sitting in storage. This route is
 * unauthenticated with a long-lived public cache, which was safe only
 * because the bucket could historically hold nothing but these four image
 * MIMEs. Now that a `file` document can put arbitrary bytes (e.g.
 * `text/html`) under a `uuid.png`-shaped key — which `VALID_IMAGE_ID_PATTERN`
 * still accepts — echoing a stored `text/html` here would be live
 * unauthenticated stored XSS on the backend origin. `VALID_IMAGE_ID_PATTERN`
 * already restricts `id` to one of these four extensions, so this map is
 * exhaustive for anything that reaches this point.
 */
const EXT_CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

@Controller('images')
@Throttle(IMAGE_THROTTLE)
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
    if (!VALID_IMAGE_ID_PATTERN.test(id)) {
      throw new BadRequestException('Invalid image id');
    }
    const { body } = await this.imageService.getObject(id);
    const ext = id.split('.').pop()!.toLowerCase();
    res.setHeader(
      'Content-Type',
      EXT_CONTENT_TYPE[ext] ?? 'application/octet-stream',
    );
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(Buffer.from(body));
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    if (!VALID_IMAGE_ID_PATTERN.test(id)) {
      throw new BadRequestException('Invalid image id');
    }
    await this.imageService.delete(id);
    return { deleted: true };
  }
}
