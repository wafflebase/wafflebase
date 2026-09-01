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
  NotFoundException,
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

  /**
   * A missing object answers **404**, not the 500 an unhandled S3 `NoSuchKey`
   * produces. An id here outlives whatever referenced it — a template listing
   * stores one and the object can be deleted underneath it — so "this image is
   * gone" is an ordinary outcome of a public route, not a server fault, and it
   * must not fill the error log with stack traces every time a stale card is
   * painted. Mirrors `ApiV1ImageReadController`, which already does this.
   */
  @Get(':id')
  async get(@Param('id') id: string, @Res() res: Response): Promise<void> {
    if (!VALID_IMAGE_ID_PATTERN.test(id)) {
      throw new BadRequestException('Invalid image id');
    }
    const { body } = await this.imageService.getObject(id).catch((err) => {
      // Only a genuinely absent object becomes a 404. An S3 outage, an expired
      // credential or a timeout stays itself (a 500), because reporting an
      // incident as "not found" is exactly the signal you need during one.
      if (isMissingObject(err)) throw new NotFoundException('Image not found');
      throw err;
    });
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

/**
 * Whether `err` is S3 saying the key does not exist, as opposed to saying
 * anything else. Both spellings are checked because the SDK reports a missing
 * key as `NoSuchKey` on `GetObject` and as a bare 404 on some other paths.
 */
function isMissingObject(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}
