import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  applyWorksheetMove,
  applyWorksheetShift,
  crossesFreezePane,
  getWorksheetCell,
  initialSpreadsheetDocument,
  isMergeSplitByMove,
  moveCrossTabDataRanges,
  moveMergeMap,
  normalizeStoredCell,
  parseRef,
  safeWorksheetRecordEntries,
  shiftCrossTabDataRanges,
  toMergeRange,
  toRefsFromRanges,
  writeWorksheetCell,
} from '@wafflebase/sheets';
import type { Axis, SpreadsheetDocument, Worksheet } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { assertSheetDocument } from './sheet-document.util';
import { worksheetOrThrow } from './worksheet-lookup.util';
import {
  assertAxisGrowth,
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
 * styles, conditional formats, validations, chart ranges, comment anchors and
 * the index-keyed view state (filter range, hidden rows/columns, freeze pane)
 * are carried along exactly as they are in the UI — including the cross-tab
 * pass that repoints other tabs' chart ranges at the edited one.
 *
 * Two things deliberately differ from the editor:
 *
 * - **Cached formula values are cleared, not recalculated.** The calculator
 *   needs a live `Sheet` over a `Store` and is `async`, while this mutation is
 *   a synchronous `doc.update` callback, so there is no way to recompute here.
 *   `GET .../cells` therefore reports `value: null` for formula cells on the
 *   edited tab until an editor session opens the document and recalculates.
 *   Serving a stale number that no longer matches the formula beside it would
 *   be worse.
 * - **A move that would split a merged range, or leave one across a frozen
 *   boundary, is refused with 409.** The editor silently no-ops on the first
 *   and reports a refusal the user sees on the second; for an API, silence is
 *   indistinguishable from success.
 *
 * An insert or delete is *not* refused for the same reason, because it can
 * repair itself: it moves the freeze boundary and the merge map independently,
 * so either edge can come to rest inside a merged block, and
 * `shiftWorksheetViewState` then snaps the boundary past that block — the same
 * repair `setFreezePane` and `Sheet.shiftCells` apply. So a successful insert
 * or delete may leave the tab with more frozen rows or columns than it had;
 * read them back with `GET .../freeze` if that matters to the caller.
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1WorksheetStructureController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  private assertSheetDocument(documentId: string, workspaceId: string) {
    return assertSheetDocument(
      this.documentService,
      'Worksheet structure operations',
      documentId,
      workspaceId,
    );
  }

  /**
   * Row/column edits are only meaningful on a normal sheet tab.
   *
   * `Sheet.insertRows` / `deleteRows` / `insertColumns` / `deleteColumns` all
   * open with `if (this.pivotDefinition) return;`, and a `datasource` /
   * `lakehouse` tab's grid is re-materialized from its query on every refresh,
   * so a shift applied here would be silently discarded. Refusing at the
   * boundary mirrors `assertSheetDocument`: say no rather than write something
   * the editor would never produce.
   *
   * Reading `root.tabs?.[tabId]` is safe only because `worksheetOrThrow`
   * (`worksheet-lookup.util.ts`) has already proved `tabId` is a real key —
   * keep the call order.
   */
  private assertEditableTab(
    root: { tabs?: Record<string, { type?: string } | undefined> },
    ws: Worksheet,
    tabId: string,
  ) {
    const type = root.tabs?.[tabId]?.type ?? 'sheet';
    if (type !== 'sheet') {
      throw new BadRequestException(
        `Row and column edits are only available on sheet tabs; "${tabId}" is a "${type}" tab.`,
      );
    }
    if (ws.pivotTable) {
      throw new BadRequestException(
        `"${tabId}" is a pivot-output tab; its rows and columns are regenerated from the pivot definition.`,
      );
    }
  }

  /**
   * `length` on a Yorkie array is O(1) — unlike the `getRowOrder()`-style
   * copies elsewhere, which materialize the whole axis.
   */
  private axisLength(ws: Worksheet, axis: Axis): number {
    const order = axis === 'row' ? ws.rowOrder : ws.colOrder;
    return order?.length ?? 0;
  }

  /**
   * Refuse a move that would cut a merged block in half.
   *
   * `Sheet.moveCells` abandons the whole operation in that case. Without the
   * check `moveMergeMap` remaps the merge's two corners independently and
   * rebuilds a span from them, so `A1:A3` with row 2 moved away silently
   * becomes `A1:A2` — a merge over cells that were never merged — or, when the
   * remap collapses it to 1×1, is dropped entirely. Either way the cell move
   * itself has already gone through.
   *
   * 409 rather than 400: the body is well-formed and legal in isolation, and
   * whether it is refused depends on the document's current merges. The editor
   * silently no-ops instead; for an API, silence is indistinguishable from
   * success, so this reports.
   */
  private assertMoveKeepsMerges(
    ws: Worksheet,
    axis: Axis,
    srcIndex: number,
    count: number,
  ) {
    for (const [anchorSref, span] of safeWorksheetRecordEntries(
      ws.merges ?? {},
    )) {
      if (
        isMergeSplitByMove(parseRef(anchorSref), span, axis, srcIndex, count)
      ) {
        throw new ConflictException(
          `The move would split the merged range anchored at ${anchorSref}; ` +
            `move the whole merged block or unmerge it first.`,
        );
      }
    }
  }

  /**
   * Refuse a move that would park a merged block across a frozen boundary.
   *
   * `Sheet.moveCells` refuses the same reorder (`merge-move-frozen`): the
   * renderer paints the frozen pane and the scrolling body from a single
   * block, so a straddling one is not drawable, and merging, pasting and
   * drag-moving all refuse to create it. Without this check the API is the one
   * door into a state the editor cannot paint.
   *
   * The reorder does not move the boundary, so the check runs against the
   * merge map the move *would* produce — before `applyWorksheetMove` writes
   * anything, since a throw inside `doc.update` rolls the whole update back.
   */
  private assertMoveKeepsMergesOffFreeze(
    ws: Worksheet,
    axis: Axis,
    srcIndex: number,
    count: number,
    dstIndex: number,
  ) {
    const frozenRows = ws.frozenRows ?? 0;
    const frozenCols = ws.frozenCols ?? 0;
    if (frozenRows === 0 && frozenCols === 0) return;

    const merges = new Map(safeWorksheetRecordEntries(ws.merges ?? {}));
    const moved = moveMergeMap(merges, axis, srcIndex, count, dstIndex);
    for (const [anchorSref, span] of moved) {
      const range = toMergeRange(parseRef(anchorSref), span);
      if (crossesFreezePane(range, frozenRows, frozenCols)) {
        throw new ConflictException(
          `The move would leave the merged range anchored at ${anchorSref} ` +
            `across the frozen rows or columns; move it to one side of the ` +
            `freeze, or unfreeze first.`,
        );
      }
    }
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
          const ws = worksheetOrThrow<Worksheet>(root, tabId);
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
    // The negation is an engine convention, not part of the request: echo back
    // what the caller sent.
    await this.applyShift(documentId, tabId, axis, index, -count);
    return { axis, index, count };
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
          const ws = worksheetOrThrow<Worksheet>(root, tabId);
          this.assertEditableTab(root, ws, tabId);
          // `moveWorksheetAxis` back-fills the axis to cover both ends of the
          // move before splicing in place, so this is the length it needs to
          // exist. Checked before the first mutation: a throw inside
          // `doc.update` rolls the whole update back.
          const current = this.axisLength(ws, axis);
          assertAxisGrowth(
            axis,
            current,
            Math.max(current, srcIndex + count - 1, dstIndex - 1),
          );
          this.assertMoveKeepsMerges(ws, axis, srcIndex, count);
          this.assertMoveKeepsMergesOffFreeze(
            ws,
            axis,
            srcIndex,
            count,
            dstIndex,
          );
          applyWorksheetMove({
            ws,
            axis,
            srcIndex,
            count,
            dstIndex,
            normalizeCell: normalizeStoredCell,
            invalidateFormulaValues: true,
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
          const ws = worksheetOrThrow<Worksheet>(root, tabId);
          this.assertEditableTab(root, ws, tabId);
          if (count > 0) {
            // Insert only: a delete splices entries out and materializes none,
            // so "delete every row" must stay legal. `insertWorksheetAxis`
            // back-fills to `index - 1` and then adds `count`, which is the
            // axis length the request leaves behind.
            const current = this.axisLength(ws, axis);
            assertAxisGrowth(
              axis,
              current,
              Math.max(current, index - 1) + count,
            );
          }
          applyWorksheetShift({
            ws,
            axis,
            index,
            count,
            normalizeCell: normalizeStoredCell,
            invalidateFormulaValues: true,
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
