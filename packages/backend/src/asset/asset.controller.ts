import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AssetService, ImageUploadFile } from './asset.service';

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

@Controller('assets')
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post('images')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_IMAGE_UPLOAD_BYTES,
      },
    }),
  )
  async uploadImage(@UploadedFile() file: ImageUploadFile) {
    return this.assetService.uploadImage(file);
  }

  @Get('images/:key')
  async getImage(@Param('key') key: string, @Res() res: Response): Promise<void> {
    const image = await this.assetService.getImage(key);
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Cache-Control', image.cacheControl);
    if (image.contentLength !== undefined) {
      res.setHeader('Content-Length', String(image.contentLength));
    }
    image.body.pipe(res);
  }
}
