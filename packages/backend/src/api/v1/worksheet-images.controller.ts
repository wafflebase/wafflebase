import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { initialSpreadsheetDocument } from '@wafflebase/sheets';
import type { SheetImage } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { parseImages } from '../../yorkie/worksheet-images';
import { unwrapJson } from '../../yorkie/yorkie-json';

/**
 * Floating images on a spreadsheet tab.
 *
 * The workspace image routes (`POST|GET|DELETE .../images/:imageId`) store and
 * serve bytes; this one places them. `src` is whatever URL the upload returned,
 * kept verbatim so one uploaded image can be anchored on several worksheets.
 *
 * PUT replaces the whole collection, keyed by each image's `id`, which is the
 * same replace rule `charts` follows — an image missing from the payload is
 * deleted.
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1WorksheetImagesController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  private async assertSheetDocument(documentId: string, workspaceId: string) {
    const doc = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    if (doc.type !== 'sheet') {
      throw new BadRequestException(
        `Worksheet images are only available on sheet documents; "${documentId}" is a "${doc.type}" document.`,
      );
    }
    return doc;
  }

  private worksheetOrThrow(
    root: { sheets?: Record<string, unknown> },
    tabId: string,
  ) {
    const worksheet = root.sheets?.[tabId];
    if (!worksheet) throw new NotFoundException('Tab not found');
    return worksheet as Record<string, unknown>;
  }

  @Get('images')
  async getImages(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = doc.getRoot().sheets?.[tabId] as
          | { images?: unknown }
          | undefined;
        const out: SheetImage[] = [];
        if (ws?.images && typeof ws.images === 'object') {
          for (const value of Object.values(ws.images)) {
            // `unwrapJson` for the same reason the chart reader uses it: a
            // stored image is a Yorkie object proxy, and only its own `toJSON`
            // hands back detached JSON that `res.json()` can serialize.
            const image = unwrapJson<SheetImage>(value);
            if (image && typeof image === 'object') out.push(image);
          }
        }
        return { images: out };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('images')
  async setImages(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const images = parseImages(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = this.worksheetOrThrow(root, tabId) as {
            images?: Record<string, SheetImage>;
          };
          ws.images = {};
          for (const image of images) ws.images[image.id] = image;
        });
        return { images };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
