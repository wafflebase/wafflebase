import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { initialSpreadsheetDocument } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { assertSheetDocument } from './sheet-document.util';
import {
  parseFreeze,
  parseHidden,
  parseMerges,
} from '../../yorkie/worksheet-settings';
import { findWorksheet, worksheetOrThrow } from './worksheet-lookup.util';

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

  private assertSheetDocument(documentId: string, workspaceId: string) {
    return assertSheetDocument(
      this.documentService,
      'Worksheet settings',
      documentId,
      workspaceId,
    );
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
        const ws = findWorksheet<{
          frozenRows?: number;
          frozenCols?: number;
        }>(doc.getRoot(), tabId);
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
          const ws = worksheetOrThrow(root, tabId);
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
        const ws = findWorksheet<{
          hiddenRows?: number[];
          hiddenColumns?: number[];
        }>(doc.getRoot(), tabId);
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
          const ws = worksheetOrThrow(root, tabId);
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
        const ws = findWorksheet<{
          merges?: Record<string, { rs: number; cs: number }>;
        }>(doc.getRoot(), tabId);
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
          const ws = worksheetOrThrow(root, tabId);
          ws.merges = merges;
        });
        return { merges };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
