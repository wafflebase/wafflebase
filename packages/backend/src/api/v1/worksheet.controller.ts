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
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import {
  parseFreeze,
  parseHidden,
  parseMerges,
} from '../../yorkie/worksheet-settings';

/**
 * Worksheet-level settings for a spreadsheet tab: freeze panes, hidden
 * rows/columns, and merged cells. Each is a direct field on the worksheet, so
 * a PUT validates then replaces the field and a GET returns it as plain JSON
 * (a Yorkie array/object serializes via toJSON to a *string* otherwise).
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1WorksheetController {
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
        `Worksheet settings are only available on sheet documents; "${documentId}" is a "${doc.type}" document.`,
      );
    }
    return doc;
  }

  private worksheetOrThrow(root: { sheets?: Record<string, unknown> }, tabId: string) {
    const worksheet = root.sheets?.[tabId];
    if (!worksheet) throw new NotFoundException('Tab not found');
    return worksheet as Record<string, unknown>;
  }

  // Freeze panes
  @Get('freeze')
  async getFreeze(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = doc.getRoot().sheets?.[tabId] as
          | { frozenRows?: number; frozenCols?: number }
          | undefined;
        return { rows: ws?.frozenRows ?? 0, cols: ws?.frozenCols ?? 0 };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('freeze')
  async setFreeze(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const { rows, cols } = parseFreeze(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = this.worksheetOrThrow(root, tabId);
          ws.frozenRows = rows;
          ws.frozenCols = cols;
        });
        return { rows, cols };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  // Hidden rows / columns
  @Get('hidden')
  async getHidden(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = doc.getRoot().sheets?.[tabId] as
          | { hiddenRows?: number[]; hiddenColumns?: number[] }
          | undefined;
        return {
          rows: ws?.hiddenRows ? [...ws.hiddenRows] : [],
          columns: ws?.hiddenColumns ? [...ws.hiddenColumns] : [],
        };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('hidden')
  async setHidden(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const { rows, columns } = parseHidden(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = this.worksheetOrThrow(root, tabId);
          ws.hiddenRows = rows;
          ws.hiddenColumns = columns;
        });
        return { rows, columns };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  // Merged cells
  @Get('merges')
  async getMerges(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = doc.getRoot().sheets?.[tabId] as
          | { merges?: Record<string, { rs: number; cs: number }> }
          | undefined;
        const merges: Record<string, { rs: number; cs: number }> = {};
        for (const [ref, span] of Object.entries(ws?.merges ?? {})) {
          merges[ref] = { ...span };
        }
        return { merges };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('merges')
  async setMerges(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const merges = parseMerges(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = this.worksheetOrThrow(root, tabId);
          ws.merges = merges;
        });
        return { merges };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
