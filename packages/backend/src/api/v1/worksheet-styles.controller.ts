import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
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

  private worksheetOrThrow(
    root: { sheets?: Record<string, unknown> },
    tabId: string,
  ) {
    const worksheet = root.sheets?.[tabId];
    if (!worksheet) throw new NotFoundException('Tab not found');
    return worksheet as Record<string, unknown>;
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
        const ws = doc.getRoot().sheets?.[tabId] as
          | { rangeStyles?: RangeStylePatch[] }
          | undefined;
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
          this.worksheetOrThrow(root, tabId).rangeStyles = rangeStyles;
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
        const ws = doc.getRoot().sheets?.[tabId] as
          | { sheetStyle?: CellStyle }
          | undefined;
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
          const ws = this.worksheetOrThrow(root, tabId) as {
            sheetStyle?: CellStyle;
          };
          if (style === null) delete ws.sheetStyle;
          else ws.sheetStyle = { ...(ws.sheetStyle ?? {}), ...style };
        });
        return { style };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
