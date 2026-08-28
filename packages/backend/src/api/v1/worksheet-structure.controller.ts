import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  applyWorksheetMove,
  applyWorksheetShift,
  getWorksheetCell,
  initialSpreadsheetDocument,
  moveCrossTabDataRanges,
  normalizeStoredCell,
  shiftCrossTabDataRanges,
  toRefsFromRanges,
  writeWorksheetCell,
} from '@wafflebase/sheets';
import type { SpreadsheetDocument, Worksheet } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import {
  parseAxisMove,
  parseAxisShift,
  parseClearRange,
} from '../../yorkie/worksheet-structure';

/**
 * Structural operations for a spreadsheet tab: clearing a range, and
 * inserting, deleting or moving rows and columns.
 *
 * The row/column operations run the same engine helpers the editor does
 * (`applyWorksheetShift` / `applyWorksheetMove`), so formulas, merges, range
 * styles, conditional formats, validations, chart ranges and comment anchors
 * are carried along exactly as they are in the UI — including the cross-tab
 * pass that repoints other tabs' chart ranges at the edited one.
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1WorksheetStructureController {
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
        `Worksheet structure operations are only available on sheet documents; "${documentId}" is a "${doc.type}" document.`,
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
    return worksheet as Worksheet;
  }

  @Post('clear')
  async clearRange(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const range = parseClearRange(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        let cleared = 0;
        doc.update((root) => {
          const ws = this.worksheetOrThrow(root, tabId);
          for (const ref of toRefsFromRanges([range])) {
            if (getWorksheetCell(ws, ref) !== undefined) {
              writeWorksheetCell(ws, ref, undefined);
              cleared++;
            }
          }
        });
        return { cleared };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
  /**
   * Insert `count` rows or columns before `index`, shifting everything at or
   * below/right of it down/right.
   */
  @Post('insert')
  async insertAxis(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const { axis, index, count } = parseAxisShift(body);
    return this.applyShift(documentId, tabId, axis, index, count);
  }

  /**
   * Delete `count` rows or columns starting at `index`. The engine takes a
   * negative count for a delete, which is where the sign is applied.
   */
  @Post('delete')
  async deleteAxis(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const { axis, index, count } = parseAxisShift(body);
    return this.applyShift(documentId, tabId, axis, index, -count);
  }

  /** Move `count` rows or columns from `srcIndex` to before `dstIndex`. */
  @Post('move')
  async moveAxis(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const { axis, srcIndex, count, dstIndex } = parseAxisMove(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = this.worksheetOrThrow(root, tabId);
          applyWorksheetMove({
            ws,
            axis,
            srcIndex,
            count,
            dstIndex,
            normalizeCell: normalizeStoredCell,
          });
          moveCrossTabDataRanges(
            (root as SpreadsheetDocument).sheets,
            tabId,
            axis,
            srcIndex,
            count,
            dstIndex,
          );
        });
        return { axis, srcIndex, count, dstIndex };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  /**
   * Shared by insert and delete: both are one `applyWorksheetShift` plus the
   * cross-tab chart-range pass, differing only in the sign of `count`.
   */
  private applyShift(
    documentId: string,
    tabId: string,
    axis: 'row' | 'column',
    index: number,
    count: number,
  ) {
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = this.worksheetOrThrow(root, tabId);
          applyWorksheetShift({
            ws,
            axis,
            index,
            count,
            normalizeCell: normalizeStoredCell,
          });
          shiftCrossTabDataRanges(
            (root as SpreadsheetDocument).sheets,
            tabId,
            axis,
            index,
            count,
          );
        });
        return { axis, index, count };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
