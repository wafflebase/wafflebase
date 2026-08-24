import {
  Controller,
  Post,
  Delete,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { ImageService } from '../../image/image.service';
import { VALID_IMAGE_ID_PATTERN } from '../../image/image.constants';
import type { Request } from 'express';

@Controller('api/v1/workspaces/:workspaceId/images')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
export class ApiV1ImagesController {
  constructor(private readonly imageService: ImageService) {}

  /** Build an S3 key scoped to the workspace: `{workspaceId}/{imageId}` */
  private scopedKey(req: Request, imageId: string): string {
    const workspaceId = req.params.workspaceId;
    return `${workspaceId}/${imageId}`;
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'image/png',
          'image/jpeg',
          'image/gif',
          'image/webp',
        ];
        if (!allowed.includes(file.mimetype)) {
          cb(
            new BadRequestException(
              `Unsupported file type: ${file.mimetype}`,
            ),
            false,
          );
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ): Promise<{ id: string; url: string }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const workspaceId = req.params.workspaceId;
    const result = await this.imageService.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
      workspaceId,
    );
    // Return workspace-scoped URL. Retrieval (GET) is served by
    // ApiV1ImageReadController, which additionally accepts an anonymous
    // share-link `?token=` so images embedded in a shared document load.
    const url = `/api/v1/workspaces/${workspaceId}/images/${result.id}`;
    return { id: result.id, url };
  }

  @Delete(':imageId')
  async delete(
    @Param('imageId') imageId: string,
    @Req() req: Request,
  ): Promise<{ deleted: boolean }> {
    if (!VALID_IMAGE_ID_PATTERN.test(imageId)) {
      throw new BadRequestException('Invalid image id');
    }
    await this.imageService.delete(this.scopedKey(req, imageId));
    return { deleted: true };
  }
}
