import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { DocumentService } from '../../document/document.service';
import {
  assertFileIdAllowed,
  blobDocumentTypeFor,
} from '../../document/document-file-id.util';
import { fileResponseHeaders } from '../../document/file-response.util';
import { FileService } from '../../file/file.service';
import { FolderService } from '../../folder/folder.service';
import {
  MAX_FILE_UPLOAD_BYTES,
  VALID_FILE_ID_PATTERN,
} from '../../file/file.constants';
import { AuthenticatedRequest } from '../../auth/auth.types';

/** `CreateDocumentDto`'s limits, enforced by hand on the multipart path. */
const MAX_TITLE_LENGTH = 200;
const MAX_MIME_TYPE_LENGTH = 255;

/**
 * Blob documents over the API-key-capable v1 surface — the CLI's equivalent of
 * dropping a file on the documents list.
 *
 * The browser uploads the blob and creates the document in two calls, because
 * its queue must survive a reload and resume without orphaning a second blob.
 * A CLI invocation has no resumable state, so upload here is one call that does
 * both and cleans up the blob if the document row fails — no orphan, and no
 * two-phase protocol for clients to get wrong.
 */
@Controller('api/v1/workspaces/:workspaceId/files')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard)
// Match the inline-image routes' raised bucket: a scripted upload loop bursts
// past the global 120/min default.
@Throttle({ default: { limit: 600, ttl: 60_000 } })
export class ApiV1FilesController {
  constructor(
    private readonly fileService: FileService,
    private readonly documentService: DocumentService,
    private readonly folderService: FolderService,
  ) {}

  @Post()
  // Cap at the Multer layer so an oversized body is rejected during parsing
  // rather than being fully buffered into memory first.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_UPLOAD_BYTES } }),
  )
  async upload(
    @Param('workspaceId') workspaceId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { title?: string; folderId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    // `CombinedAuthGuard` only proves the key is valid, and
    // `WorkspaceScopeGuard` only that it is bound to this workspace — neither
    // reads `scopes`. Without this a read-scoped key could create documents.
    // Mirrors the check on `documents.delete`.
    if (req.user.isApiKey && !req.user.scopes?.includes('write')) {
      throw new ForbiddenException('This API key does not have write access');
    }

    // Resolve the title before storing anything: a rejected title should not
    // cost an upload, even though the cleanup below would cover it.
    const title = defaultTitle(body?.title, file.originalname);
    // Same reasoning as the title: resolve before storing anything, so a
    // folder from another workspace costs no upload. `assertSameWorkspace` is
    // the check `document.controller.ts` already applies on its create path —
    // without it, a workspace-scoped caller could file a document into a
    // folder they cannot otherwise reach.
    const folderId = body?.folderId?.trim() || undefined;
    if (folderId) {
      await this.folderService.assertSameWorkspace(folderId, workspaceId);
    }
    // Client-supplied and advisory only, but it is persisted, so hold it to
    // the same length the DTO path enforces.
    const mimeType = (file.mimetype ?? '').slice(0, MAX_MIME_TYPE_LENGTH);

    const uploaded = await this.fileService.upload(
      file.buffer,
      mimeType,
      file.originalname,
    );
    // Derive the type from the *stored* id, whose extension has already been
    // sanitized — so the pairing can never fail the guard below.
    const type = blobDocumentTypeFor(uploaded.id);

    try {
      assertFileIdAllowed(type, uploaded.id);
      return await this.documentService.createDocument({
        title,
        type,
        fileId: uploaded.id,
        fileSize: uploaded.size,
        mimeType: uploaded.mimeType,
        workspace: { connect: { id: workspaceId } },
        author: { connect: { id: Number(req.user.id) } },
        ...(folderId ? { folder: { connect: { id: folderId } } } : {}),
      });
    } catch (err) {
      // A blob is only reachable through its document row; without one it is
      // unreferenced garbage nothing will ever collect. Best-effort delete —
      // the original failure is what the caller needs to see.
      await this.fileService.delete(uploaded.id).catch(() => undefined);
      throw err;
    }
  }

  @Get(':documentId')
  async download(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const doc = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    if (!doc.fileId || !VALID_FILE_ID_PATTERN.test(doc.fileId)) {
      throw new NotFoundException('Document has no file');
    }

    const { body, contentType } = await this.fileService.getObject(doc.fileId);
    // Same derived-not-echoed rule as `GET /documents/:id/file`; reusing the
    // helper keeps one serving policy rather than two that can drift.
    const headers = fileResponseHeaders(
      doc.type,
      contentType,
      doc.title,
      doc.fileId,
    );
    res.setHeader('Content-Type', headers.contentType);
    res.setHeader('Content-Disposition', headers.disposition);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(Buffer.from(body));
  }
}

/**
 * Document title for an uploaded blob: the caller's `title` field, else the
 * filename without its extension. Mirrors the browser's `stripExt` — the
 * extension is re-appended from the stored `fileId` on download, so dropping
 * it here is what makes `report.zip` come back as `report.zip`.
 *
 * A multipart body carries no DTO validation, so `CreateDocumentDto`'s
 * `@Length(1, 200)` is applied by hand. The two sources are treated
 * differently on purpose: an over-long explicit title is a mistake worth
 * reporting, while an over-long *filename* should still upload — the title is
 * a display label, and truncating it loses nothing the bytes depend on.
 */
function defaultTitle(title: string | undefined, fileName: string): string {
  const explicit = title?.trim();
  if (explicit) {
    if (explicit.length > MAX_TITLE_LENGTH) {
      throw new BadRequestException(
        `title must be at most ${MAX_TITLE_LENGTH} characters`,
      );
    }
    return explicit;
  }
  // The whole basename, extension included: a blob document *is* the file, so
  // its title is the filename. Dropping the extension made four uploads of
  // `report.{zip,pdf,png,c++}` indistinguishable in the list, and it was also
  // the only surviving copy of an extension that `safeExtension` rejects — a
  // `.c++` blob is stored under a bare uuid, so `attachmentFilename` has
  // nothing to re-append and the download loses it for good.
  const base = (fileName.split(/[\\/]/).pop() ?? fileName).trim();
  return base.slice(0, MAX_TITLE_LENGTH) || 'Untitled File';
}
