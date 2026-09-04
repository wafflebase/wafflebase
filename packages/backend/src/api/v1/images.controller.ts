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
import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_UPLOAD_MULTER_LIMIT_BYTES,
  VALID_IMAGE_ID_PATTERN,
  unsupportedFileTypeMessage,
} from '../../image/image.constants';
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

  /**
   * Both the size limit and the MIME allowlist come from `image.constants`,
   * which is also what `image.config.ts` derives `image.maxFileSizeBytes` and
   * `image.allowedMimeTypes` from. They cannot be read from `ConfigService`
   * here: a `FileInterceptor(...)` argument is evaluated when this class is
   * decorated, before any injector exists. Hardcoding either number is what let
   * this route and `POST /images` disagree — an image of exactly 10 MB was
   * accepted there and 413'd here, while the shared `ImageService.upload` both
   * end in accepts it.
   *
   * See `IMAGE_UPLOAD_MULTER_LIMIT_BYTES` for why the limit is the cap `+ 1`.
   * The refusal wording is shared the same way, via
   * `unsupportedFileTypeMessage`: this filter and the `ImageService.upload`
   * check behind it are one refusal seen at two depths, so a client must not
   * be able to tell which of them answered.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: IMAGE_UPLOAD_MULTER_LIMIT_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
          cb(
            new BadRequestException(unsupportedFileTypeMessage(file.mimetype)),
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
