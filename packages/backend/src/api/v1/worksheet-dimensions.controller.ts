import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { initialSpreadsheetDocument } from '@wafflebase/sheets';
import type { CellStyle } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { assertSheetDocument } from './sheet-document.util';
import {
  parseIndexKeyedSizes,
  parseIndexKeyedStyles,
  type SizeEntries,
  type StyleEntries,
} from '../../yorkie/worksheet-dimensions';
import { findWorksheet, worksheetOrThrow } from './worksheet-lookup.util';

type IndexStyleMap = { [index: string]: CellStyle };
type IndexSizeMap = { [index: string]: number };

/**
 * Whole-column and whole-row formatting and sizing for a spreadsheet tab.
 * Column/row styles are `CellStyle` maps and widths/heights are number maps,
 * both keyed by the 1-based column/row index as a string (`"1"` = column A /
 * the first row), matching the frontend store. A PUT merges per index (a
 * `null` value clears that index); a GET returns the plain map since a Yorkie
 * value's toJSON would serialize as a string.
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1WorksheetDimensionsController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  private assertSheetDocument(documentId: string, workspaceId: string) {
    return assertSheetDocument(
      this.documentService,
      'Worksheet dimensions',
      documentId,
      workspaceId,
    );
  }

  private readStyleMap(source: unknown): IndexStyleMap {
    const out: IndexStyleMap = {};
    if (source && typeof source === 'object') {
      for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === 'object') {
          out[key] = { ...(value as CellStyle) };
        }
      }
    }
    return out;
  }

  private readSizeMap(source: unknown): IndexSizeMap {
    const out: IndexSizeMap = {};
    if (source && typeof source === 'object') {
      for (const [key, value] of Object.entries(source)) {
        if (typeof value === 'number') out[key] = value;
      }
    }
    return out;
  }

  private applyStyleEntries(
    target: Record<string, CellStyle>,
    entries: StyleEntries,
  ): void {
    for (const [index, style] of entries) {
      if (style === null) delete target[index];
      else target[index] = { ...(target[index] ?? {}), ...style };
    }
  }

  private applySizeEntries(
    target: Record<string, number>,
    entries: SizeEntries,
  ): void {
    for (const [index, size] of entries) {
      if (size === null) delete target[index];
      else target[index] = size;
    }
  }

  @Get('column-styles')
  async getColumnStyles(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = findWorksheet<{ colStyles?: unknown }>(doc.getRoot(), tabId);
        return { columnStyles: this.readStyleMap(ws?.colStyles) };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('column-styles')
  async setColumnStyles(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const entries = parseIndexKeyedStyles(body, 'columnStyles');
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = worksheetOrThrow<{
            colStyles?: Record<string, CellStyle>;
          }>(root, tabId);
          ws.colStyles ??= {};
          this.applyStyleEntries(ws.colStyles, entries);
        });
        const ws = findWorksheet<{ colStyles?: unknown }>(doc.getRoot(), tabId);
        return { columnStyles: this.readStyleMap(ws?.colStyles) };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  @Get('row-styles')
  async getRowStyles(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = findWorksheet<{ rowStyles?: unknown }>(doc.getRoot(), tabId);
        return { rowStyles: this.readStyleMap(ws?.rowStyles) };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('row-styles')
  async setRowStyles(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const entries = parseIndexKeyedStyles(body, 'rowStyles');
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = worksheetOrThrow<{
            rowStyles?: Record<string, CellStyle>;
          }>(root, tabId);
          ws.rowStyles ??= {};
          this.applyStyleEntries(ws.rowStyles, entries);
        });
        const ws = findWorksheet<{ rowStyles?: unknown }>(doc.getRoot(), tabId);
        return { rowStyles: this.readStyleMap(ws?.rowStyles) };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  @Get('column-widths')
  async getColumnWidths(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = findWorksheet<{ colWidths?: unknown }>(doc.getRoot(), tabId);
        return { columnWidths: this.readSizeMap(ws?.colWidths) };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('column-widths')
  async setColumnWidths(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const entries = parseIndexKeyedSizes(body, 'columnWidths');
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = worksheetOrThrow<{
            colWidths?: Record<string, number>;
          }>(root, tabId);
          ws.colWidths ??= {};
          this.applySizeEntries(ws.colWidths, entries);
        });
        const ws = findWorksheet<{ colWidths?: unknown }>(doc.getRoot(), tabId);
        return { columnWidths: this.readSizeMap(ws?.colWidths) };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  @Get('row-heights')
  async getRowHeights(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = findWorksheet<{ rowHeights?: unknown }>(doc.getRoot(), tabId);
        return { rowHeights: this.readSizeMap(ws?.rowHeights) };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('row-heights')
  async setRowHeights(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const entries = parseIndexKeyedSizes(body, 'rowHeights');
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = worksheetOrThrow<{
            rowHeights?: Record<string, number>;
          }>(root, tabId);
          ws.rowHeights ??= {};
          this.applySizeEntries(ws.rowHeights, entries);
        });
        const ws = findWorksheet<{ rowHeights?: unknown }>(doc.getRoot(), tabId);
        return { rowHeights: this.readSizeMap(ws?.rowHeights) };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
