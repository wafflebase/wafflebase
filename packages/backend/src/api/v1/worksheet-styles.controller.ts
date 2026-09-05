import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  initialSpreadsheetDocument,
  normalizeRangeStylePatch,
} from '@wafflebase/sheets';
import type { CellStyle, RangeStylePatch } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { assertSheetDocument } from './sheet-document.util';
import {
  parseRangeStyles,
  parseSheetStyle,
} from '../../yorkie/worksheet-styles';
import { findWorksheet, worksheetOrThrow } from './worksheet-lookup.util';

/**
 * Range-scoped and whole-sheet formatting for a spreadsheet tab. `range-styles`
 * is the compact range-style layer (`{ range, style }` patches); `sheet-style`
 * is the single sheet-wide `CellStyle`. A PUT validates then writes; a GET
 * returns plain JSON (range patches are re-normalized, the sheet style is
 * spread) since a Yorkie value's toJSON would serialize as a string.
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1WorksheetStylesController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  private assertSheetDocument(documentId: string, workspaceId: string) {
    return assertSheetDocument(
      this.documentService,
      'Worksheet styles',
      documentId,
      workspaceId,
    );
  }

  @Get('range-styles')
  async getRangeStyles(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = findWorksheet<{ rangeStyles?: RangeStylePatch[] }>(
          doc.getRoot(),
          tabId,
        );
        const rangeStyles = (ws?.rangeStyles ?? [])
          .map((p) => normalizeRangeStylePatch(p))
          .filter((p): p is RangeStylePatch => Boolean(p));
        return { rangeStyles };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('range-styles')
  async setRangeStyles(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const rangeStyles = parseRangeStyles(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          worksheetOrThrow(root, tabId).rangeStyles = rangeStyles;
        });
        return { rangeStyles };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  @Get('sheet-style')
  async getSheetStyle(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = findWorksheet<{ sheetStyle?: CellStyle }>(
          doc.getRoot(),
          tabId,
        );
        return { style: ws?.sheetStyle ? { ...ws.sheetStyle } : null };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('sheet-style')
  async setSheetStyle(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const style = parseSheetStyle(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = worksheetOrThrow<{ sheetStyle?: CellStyle }>(root, tabId);
          if (style === null) delete ws.sheetStyle;
          else ws.sheetStyle = { ...(ws.sheetStyle ?? {}), ...style };
        });
        return { style };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
