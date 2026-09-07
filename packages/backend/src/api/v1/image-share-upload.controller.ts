import {
  Controller,
  Post,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ImageService } from '../../image/image.service';
import { ShareLinkService } from '../../share-link/share-link.service';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_UPLOAD_MULTER_LIMIT_BYTES,
  unsupportedFileTypeMessage,
} from '../../image/image.constants';

/**
 * The upload counterpart to {@link ApiV1ImageReadController}: the one image
 * route an **anonymous** caller may write through, authorized entirely by an
 * editor-role share `?token=`.
 *
 * It exists because image bytes were the one part of a shared document that
 * fell outside the access decision anonymous editing already makes. A visitor
 * holding an editor link can edit text, tables and comments through Yorkie —
 * `yorkie-auth.controller.ts` resolves the link and answers "yes" for a write
 * — but the docs image button posted to `POST /images`, whose bare
 * `JwtAuthGuard` answered 401. On the client that 401 was indistinguishable
 * from an expired session, so the visitor was logged out and sent to `/login`,
 * losing the document (issue #1037).
 *
 * Three things about the shape are deliberate:
 *
 * - **There is no `:workspaceId` path segment.** The prefix the bytes are
 *   stored under is read off `link.document.workspaceId`. A client-supplied id
 *   would let a token proving access to one workspace write into another's key
 *   space, and `WorkspaceScopeGuard` cannot catch that — it authorizes by
 *   calling `assertMember(user.id)`, and an anonymous caller has no user.
 * - **The role is checked, not just the token.** The two existing anonymous
 *   share-token routes (`ApiV1ImageReadController`, `DocumentFileController`)
 *   ignore `link.role` on purpose, because a viewer link is meant to read.
 *   Copying them here would let a viewer upload.
 * - **`ApiV1ImagesController` is left alone.** Its class-level
 *   `CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard` stack is
 *   the strict one; this is a sibling rather than a loosening of it, the same
 *   split `ApiV1ImageReadController` was created for.
 */
@Controller('api/v1/shared/images')
// An order of magnitude below the read routes' 600/min. Reads burst — opening
// a document with many embedded images is one request per image — whereas a
// human inserts pictures one at a time, and this is the only *unauthenticated*
// write in the image module. 30/min still absorbs pasting a handful in a row.
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class ApiV1ShareImageUploadController {
  constructor(
    private readonly imageService: ImageService,
    private readonly shareLinkService: ShareLinkService,
  ) {}

  /**
   * The blob bounds are `IMAGE_UPLOAD_MULTER_LIMIT_BYTES` and
   * `ALLOWED_IMAGE_MIME_TYPES` — the same two constants the other two upload
   * routes use, so this route cannot come to disagree with them about which
   * byte count is one too many or which MIME types exist. See the comment on
   * `ImageController.upload` for why the Multer `fileSize` limit (not just the
   * `ImageService.upload` check behind it) is what bounds *memory*.
   *
   * Nest runs interceptors after guards but before the handler, so the body is
   * buffered before `assertCanWrite` refuses it. The Multer limit bounds that
   * allocation per request and the throttle above bounds the rate; a token
   * still grants unbounded *cumulative* uploads for its lifetime, which
   * matches the repo-wide deferral of storage quota
   * (docs/design/generic-file-upload.md).
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
    @Query('token') token: string | undefined,
  ): Promise<{ id: string; url: string }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const workspaceId = await this.assertCanWrite(token);
    const result = await this.imageService.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
      workspaceId,
    );
    // The workspace-scoped read URL, served by `ApiV1ImageReadController`,
    // which accepts the same `?token=` this caller holds. Deliberately without
    // the token: this URL is stored in the CRDT and shared with every other
    // viewer plus the author, so it is tokened per-viewer at render time
    // instead (`appendShareTokenToImageUrl`).
    return {
      id: result.id,
      url: `/api/v1/workspaces/${workspaceId}/images/${result.id}`,
    };
  }

  /**
   * Write access = a valid, unexpired share token whose role is `editor`.
   * Returns the workspace the token's document belongs to, which is the key
   * prefix the bytes are stored under.
   *
   * Granularity is workspace-level, matching the read route: there is no DB
   * link from an image blob to the document that embeds it (the reference
   * lives in the CRDT), so an editor token writes into its document's
   * workspace prefix. Image ids are unguessable UUIDs, so this grants the
   * ability to *add* an object, not to read or replace an existing one.
   */
  private async assertCanWrite(token: string | undefined): Promise<string> {
    if (!token) {
      throw new ForbiddenException('A share token is required');
    }
    // findByToken throws NotFoundException / GoneException(410) itself.
    const link = await this.shareLinkService.findByToken(token);
    if (link.role !== 'editor') {
      throw new ForbiddenException('This share link is read-only');
    }
    const workspaceId = link.document?.workspaceId;
    if (!workspaceId) {
      throw new ForbiddenException('Not allowed to upload an image');
    }
    return workspaceId;
  }
}
