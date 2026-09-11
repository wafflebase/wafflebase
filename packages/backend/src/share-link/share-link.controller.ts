import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ShareLinkService } from './share-link.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';

const EXPIRATION_MAP: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

@Controller()
export class ShareLinkController {
  constructor(private readonly shareLinkService: ShareLinkService) {}

  @Post('documents/:id/share-links')
  @UseGuards(JwtAuthGuard)
  async create(
    @Param('id') documentId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { role: string; expiration: string | null },
  ) {
    const expiresAt =
      body.expiration && EXPIRATION_MAP[body.expiration]
        ? new Date(Date.now() + EXPIRATION_MAP[body.expiration])
        : null;

    return this.shareLinkService.create(
      documentId,
      body.role || 'viewer',
      Number(req.user.id),
      expiresAt,
    );
  }

  @Get('documents/:id/share-links')
  @UseGuards(JwtAuthGuard)
  async findByDocument(
    @Param('id') documentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.shareLinkService.findByDocument(
      documentId,
      Number(req.user.id),
    );
  }

  @Delete('share-links/:id')
  @UseGuards(JwtAuthGuard)
  async delete(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.shareLinkService.delete(id, Number(req.user.id));
  }

  /**
   * Resolve a share token, with the token in the **body**.
   *
   * A share token is the whole of an anonymous visitor's access, and a
   * mounted share view re-resolves it on an interval so a revoked or
   * downgraded link stops being presented as live authority. That turns a
   * once-per-page-load path segment into one request per minute per open tab,
   * each writing the credential into every access log, proxy and CDN between
   * the visitor and this handler — `logSafeUrl` redacts our own log line, and
   * nothing else's. So the periodic caller posts it instead, the same reason
   * `POST /auth/yorkie-token/share` takes its share token in a body.
   *
   * `GET /share-links/:token/resolve` below stays for the one-shot callers
   * that already exist (an older frontend served during a rollout), and keeps
   * its `SECRET_PATH_SEGMENTS` redaction rule.
   */
  @Post('share-links/resolve')
  @HttpCode(200)
  async resolveByBody(@Body() body: { token?: unknown }) {
    const token = typeof body?.token === 'string' ? body.token : '';
    return this.resolve(token);
  }

  @Get('share-links/:token/resolve')
  async resolve(@Param('token') token: string) {
    const link = await this.shareLinkService.findByToken(token);
    return {
      documentId: link.documentId,
      role: link.role,
      title: link.document.title,
      type: link.document.type,
    };
  }
}
