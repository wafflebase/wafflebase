import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ImageService } from '../../image/image.service';
import { VALID_IMAGE_ID_PATTERN } from '../../image/image.constants';
import type { Response, Request } from 'express';

@Controller('api/v1/workspaces/:workspaceId/images')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard)
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
    // Return workspace-scoped URL so retrieval goes through this controller.
    const url = `/api/v1/workspaces/${workspaceId}/images/${result.id}`;
    return { id: result.id, url };
  }

  @Get(':imageId')
  async get(
    @Param('imageId') imageId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!VALID_IMAGE_ID_PATTERN.test(imageId)) {
      throw new BadRequestException('Invalid image id');
    }
    try {
      const { body, contentType } = await this.imageService.getObject(
        this.scopedKey(req, imageId),
      );
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(Buffer.from(body));
    } catch {
      throw new NotFoundException('Image not found');
    }
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
