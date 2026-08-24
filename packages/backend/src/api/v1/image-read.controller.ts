import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OptionalCombinedAuthGuard } from '../../api-key/optional-combined-auth.guard';
import { ImageService } from '../../image/image.service';
import { WorkspaceService } from '../../workspace/workspace.service';
import { ShareLinkService } from '../../share-link/share-link.service';
import { VALID_IMAGE_ID_PATTERN } from '../../image/image.constants';
import type { Response, Request } from 'express';

interface AuthUser {
  id?: number | string;
  isApiKey?: boolean;
  workspaceId?: string;
}

/**
 * The one workspace-image route that serves both authenticated callers
 * (workspace members via JWT, or a workspace-scoped API key) and anonymous
 * share-link viewers (`?token=`). It lives in its own controller so that
 * `ApiV1ImagesController` (upload + delete) stays strictly write-gated at the
 * class level; here we resolve read access manually.
 *
 * This is the image analogue of {@link DocumentFileController}: images
 * embedded in a slides / board / docs document are fetched over a plain
 * `<img>` request that carries no CRDT/Yorkie share credential, so without
 * this path an anonymous viewer of a shared document sees every image fail to
 * load (the canvas renderer then paints an "Image unavailable" placeholder).
 */
@Controller('api/v1/workspaces/:workspaceId/images')
@UseGuards(OptionalCombinedAuthGuard)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
export class ApiV1ImageReadController {
  constructor(
    private readonly imageService: ImageService,
    private readonly workspaceService: WorkspaceService,
    private readonly shareLinkService: ShareLinkService,
  ) {}

  @Get(':imageId')
  async get(
    @Param('workspaceId') workspaceId: string,
    @Param('imageId') imageId: string,
    @Query('token') token: string | undefined,
    @Req() req: Request & { user?: AuthUser },
    @Res() res: Response,
  ): Promise<void> {
    if (!VALID_IMAGE_ID_PATTERN.test(imageId)) {
      throw new BadRequestException('Invalid image id');
    }
    const resolvedWorkspaceId =
      await this.workspaceService.resolveId(workspaceId);
    await this.assertCanRead(resolvedWorkspaceId, req.user, token);

    try {
      const { body, contentType } = await this.imageService.getObject(
        `${resolvedWorkspaceId}/${imageId}`,
      );
      res.setHeader('Content-Type', contentType);
      // Access is now gated (member / API key / share token), so the response
      // must not land in a shared cache. `immutable` still lets the viewer's
      // own browser cache it — image ids are content-addressed UUIDs.
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(Buffer.from(body));
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new NotFoundException('Image not found');
    }
  }

  /**
   * Read access = a workspace-scoped API key, OR a workspace member (JWT),
   * OR a valid, unexpired share token whose document belongs to this
   * workspace. Granularity is deliberately workspace-level, not
   * document-level: there is no DB link from an image blob to the document
   * that embeds it (the reference lives in the CRDT), and image ids are
   * unguessable UUIDs, so a viewer can only reach the images they already
   * discover through the shared documents they can open.
   */
  private async assertCanRead(
    resolvedWorkspaceId: string,
    user: AuthUser | undefined,
    token: string | undefined,
  ): Promise<void> {
    if (user?.isApiKey) {
      if (user.workspaceId === resolvedWorkspaceId) return;
      throw new ForbiddenException('API key is not scoped to this workspace');
    }
    if (user?.id !== undefined) {
      try {
        await this.workspaceService.assertMember(
          resolvedWorkspaceId,
          Number(user.id),
        );
        return;
      } catch (err) {
        // Only the expected "not a member" case falls through to the share
        // token — a DB/infra failure must surface as itself, not a 403.
        if (!(err instanceof ForbiddenException)) throw err;
        // A logged-in non-member may still hold a share token — fall through.
      }
    }
    if (token) {
      // findByToken throws NotFoundException / GoneException(410) itself.
      const link = await this.shareLinkService.findByToken(token);
      if (link.document?.workspaceId === resolvedWorkspaceId) return;
    }
    throw new ForbiddenException('Not allowed to read this image');
  }
}
