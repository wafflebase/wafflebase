import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { DocumentService } from './document.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { ShareLinkService } from '../share-link/share-link.service';
import { FileService } from '../file/file.service';
import { VALID_FILE_ID_PATTERN } from '../file/file.constants';

/**
 * The one document route that serves both workspace members (JWT) and
 * anonymous share-link viewers (`?token=`). It lives in its own controller
 * so the rest of `DocumentController` stays strictly JWT-gated at the class
 * level; here we resolve access manually.
 */
@Controller()
@UseGuards(OptionalJwtAuthGuard)
export class DocumentFileController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly workspaceService: WorkspaceService,
    private readonly shareLinkService: ShareLinkService,
    private readonly fileService: FileService,
  ) {}

  @Get('documents/:id/file')
  async getDocumentFile(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Req() req: { user?: { id: number | string } },
    @Res() res: Response,
  ): Promise<void> {
    const doc = await this.documentService.document({ id });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    await this.assertCanRead(doc.workspaceId, id, req.user?.id, token);

    if (!doc.fileId || !VALID_FILE_ID_PATTERN.test(doc.fileId)) {
      throw new NotFoundException('Document has no file');
    }
    const { body, contentType } = await this.fileService.getObject(doc.fileId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.end(Buffer.from(body));
  }

  /**
   * Read access = workspace member (via JWT) OR a valid, unexpired share
   * token whose `documentId` matches this document. Share role is irrelevant
   * for viewing the bytes; it only gates comment writes (client-side).
   */
  private async assertCanRead(
    workspaceId: string,
    documentId: string,
    userId: number | string | undefined,
    token: string | undefined,
  ): Promise<void> {
    if (userId !== undefined) {
      try {
        await this.workspaceService.assertMember(workspaceId, Number(userId));
        return;
      } catch {
        // Fall through to the share-token path.
      }
    }
    if (token) {
      // findByToken throws NotFoundException / GoneException(410) itself.
      const link = await this.shareLinkService.findByToken(token);
      if (link.documentId === documentId) return;
    }
    throw new ForbiddenException('Not allowed to read this document');
  }
}
