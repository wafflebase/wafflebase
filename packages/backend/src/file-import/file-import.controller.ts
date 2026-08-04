import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { WorkspaceScopeGuard } from '../api/v1/workspace-scope.guard';
import { FileService } from '../file/file.service';
import {
  IMPORT_FILE_NAME_PATTERN,
  MAX_DATA_UPLOAD_BYTES,
} from '../file/file.constants';
import { FileImportService } from './file-import.service';
import { PreviewFileImportDto } from './file-import.dto';

// Parsing is CPU- and memory-bound and one request can hold a DuckDB slot for
// seconds, so this is far tighter than the blob-upload bucket next to it.
const FILE_IMPORT_THROTTLE = { default: { limit: 30, ttl: 60_000 } } as const;

// `WorkspaceScopeGuard` (shared with the v1 REST API, JWT branch only here —
// there is no API key auth on this controller) rather than an inline
// `assertMember`: guards resolve before interceptors, so membership is
// settled before `FileInterceptor` buffers up to 200 MB into server memory.
// Both routes here are workspace-scoped, so it applies to the controller.
@Controller()
@UseGuards(JwtAuthGuard, WorkspaceScopeGuard)
export class FileImportController {
  constructor(
    private readonly fileImportService: FileImportService,
    private readonly fileService: FileService,
  ) {}

  /**
   * Stage a data file for server-side parsing.
   *
   * Separate from `POST /files` because a Multer limit is fixed per route and
   * applies before the type is known: putting the 200 MB data ceiling on the
   * shared route would let a 200 MB *image* be buffered into server memory in
   * full before the 25 MB image cap could reject it. Here the large limit only
   * covers uploads that actually asked for it.
   *
   * Workspace-scoped for the same reason the preview is — a blob has no owner
   * of its own — and it means a staging blob is never minted by an unscoped
   * caller. `WorkspaceScopeGuard` on the class enforces that *before* the
   * interceptor below allocates the body.
   *
   * The `fileFilter` is the other half of that: a Multer limit is a size, not
   * a type, so without it the 200 MB ceiling applies to a `.png` too and the
   * 25 MB image cap in `FileService.upload` only gets to speak once the whole
   * body is already in memory.
   */
  @Post('workspaces/:workspaceId/file-imports/upload')
  @Throttle(FILE_IMPORT_THROTTLE)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DATA_UPLOAD_BYTES },
      fileFilter: (_req, file, callback) =>
        IMPORT_FILE_NAME_PATTERN.test(file.originalname)
          ? callback(null, true)
          : callback(
              new BadRequestException(`Cannot import ${file.originalname}.`),
              false,
            ),
    }),
  )
  async upload(
    @Param('workspaceId') workspaceId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ id: string }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    // `'data'` is what keeps the declared type out of the decision: the filter
    // above already vouched for the name, so a `Content-Type` of `image/png`
    // on an `x.csv` cannot move this upload into the image category — where it
    // would meet a 25 MB cap after being buffered against a 200 MB one, and be
    // stored at the bucket root instead of the expiring `imports/` prefix.
    return this.fileService.upload(file.buffer, file.mimetype, file.originalname, {
      category: 'data',
      workspaceId,
    });
  }

  /**
   * Parse an already-uploaded data file and return its first rows.
   *
   * ## Why the workspace is in the path
   *
   * A blob has no owner to check. `POST /files` verifies only the JWT and
   * hands back a random UUID — there is no owner column and no workspace
   * link — and the one authorized read path goes through a document
   * (`document-file.controller.ts`), which this blob is not attached to yet.
   * The workspace is therefore the only thing membership can be asserted
   * against, and it goes in the path like every other workspace-scoped route
   * here (datasource, folder, api-keys, miro).
   *
   * The id itself stays an unguessable UUID, i.e. a capability token — the
   * same model the pdf/image uploads already rely on. Membership is the
   * defense layered on top, not a replacement for it.
   */
  @Post('workspaces/:workspaceId/file-imports/preview')
  @Throttle(FILE_IMPORT_THROTTLE)
  async preview(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: PreviewFileImportDto,
  ) {
    return this.fileImportService.preview(workspaceId, dto.fileId);
  }
}
