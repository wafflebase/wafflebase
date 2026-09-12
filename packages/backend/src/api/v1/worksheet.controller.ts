import {
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  crossesFreezePane,
  initialSpreadsheetDocument,
  parseRef,
  safeWorksheetRecordEntries,
  snapFreezePastMerges,
  toMergeRange,
} from '@wafflebase/sheets';
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
 *
 * Freeze and merges are not independent: a merged block that straddles a
 * frozen boundary is not drawable, because the renderer paints the frozen pane
 * and the scrolling body from a single block. The engine keeps the two apart in
 * two different ways, and both writes here mirror the engine rather than
 * inventing a third rule:
 *
 * - **Freezing snaps.** `Sheet.setFreezePane` pushes the boundary past any
 *   block it would cut in half, so `PUT freeze` does the same (shared
 *   `snapFreezePastMerges`) and answers with the boundary it actually stored,
 *   which may be past the one asked for.
 * - **Merging is refused.** `canMergeSelection` says no to a block that would
 *   straddle, so `PUT merges` answers 409 rather than quietly moving the
 *   caller's freeze line out from under them.
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
        let stored = { rows, cols };
        doc.update((root) => {
          const ws = worksheetOrThrow<{
            frozenRows?: number;
            frozenCols?: number;
            merges?: Record<string, { rs: number; cs: number }>;
          }>(root, tabId);
          // Snap past any block the requested boundary would cut in half, the
          // same way `Sheet.setFreezePane` does, and report what was stored:
          // for an API, a silently different boundary is worse than a visibly
          // adjusted one.
          const snapped = snapFreezePastMerges(
            safeWorksheetRecordEntries(ws.merges ?? {}),
            rows,
            cols,
          );
          ws.frozenRows = snapped.frozenRows;
          ws.frozenCols = snapped.frozenCols;
          stored = { rows: snapped.frozenRows, cols: snapped.frozenCols };
        });
        return stored;
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

  /**
   * Refuse a merge map that would leave a block across the tab's frozen
   * boundary — the state `canMergeSelection` refuses in the editor and the
   * renderer cannot paint. Checked before the field is replaced; a throw
   * inside `doc.update` rolls the whole update back.
   *
   * 409 rather than 400 for the reason the structure controller's merge check
   * uses it: the body is legal in isolation and only conflicts with the
   * document's current freeze.
   */
  private assertMergesClearOfFreeze(
    merges: Record<string, { rs: number; cs: number }>,
    frozenRows: number,
    frozenCols: number,
  ) {
    if (frozenRows === 0 && frozenCols === 0) return;
    for (const [anchorSref, span] of Object.entries(merges)) {
      const range = toMergeRange(parseRef(anchorSref), span);
      if (crossesFreezePane(range, frozenRows, frozenCols)) {
        throw new ConflictException(
          `The merged range anchored at ${anchorSref} would straddle the ` +
            `frozen rows or columns; keep it on one side of the freeze, or ` +
            `move the freeze first.`,
        );
      }
    }
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
          const ws = worksheetOrThrow<{
            frozenRows?: number;
            frozenCols?: number;
            merges?: Record<string, { rs: number; cs: number }>;
          }>(root, tabId);
          this.assertMergesClearOfFreeze(
            merges,
            ws.frozenRows ?? 0,
            ws.frozenCols ?? 0,
          );
          ws.merges = merges;
        });
        return { merges };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
