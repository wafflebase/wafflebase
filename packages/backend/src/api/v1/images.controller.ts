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
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ImageService } from '../../image/image.service';
import type { Response } from 'express';

const VALID_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$/i;

@Controller('api/v1/workspaces/:workspaceId/images')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard)
export class ApiV1ImagesController {
  constructor(private readonly imageService: ImageService) {}

  @Post()
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

  @Get(':imageId')
  async get(
    @Param('imageId') imageId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!VALID_ID_PATTERN.test(imageId)) {
      throw new BadRequestException('Invalid image id');
    }
    const { body, contentType } = await this.imageService.getObject(imageId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(Buffer.from(body));
  }

  @Delete(':imageId')
  async delete(
    @Param('imageId') imageId: string,
  ): Promise<{ deleted: boolean }> {
    if (!VALID_ID_PATTERN.test(imageId)) {
      throw new BadRequestException('Invalid image id');
    }
    await this.imageService.delete(imageId);
    return { deleted: true };
  }
}
