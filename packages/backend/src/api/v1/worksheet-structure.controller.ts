import {
  BadRequestException,
  Body,
  ConflictException,
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
  isMergeSplitByMove,
  moveCrossTabDataRanges,
  normalizeStoredCell,
  parseRef,
  safeWorksheetRecordEntries,
  safeWorksheetRecordKeys,
  shiftCrossTabDataRanges,
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
 * - **A move that would split a merged range is refused with 409.** The editor
 *   silently no-ops; for an API, silence is indistinguishable from success.
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
   * Resolve `tabId` against the document's own tabs.
   *
   * This has to be a membership test over the real keys, not a truthiness
   * check on the value. `root.sheets` is a Yorkie `JSONObject` proxy whose get
   * trap answers `getID` / `toJSON` / `toJS` / `toJSForTest` / `toString` with
   * a **function** — truthy — so `.../tabs/toString/insert` walked past a bare
   * `if (!worksheet)` and handed the engine a function to splice `rowOrder`
   * on. (`__proto__` is safe through that proxy only by accident: the trap
   * reads a real `Map`, so it answers `undefined`. On a plain object it is
   * truthy, which is what the clear-range spec's fixture exercises.)
   *
   * `Object.hasOwn` and `in` are both unusable here — the proxy's
   * `getOwnPropertyDescriptor` trap returns a descriptor unconditionally, and
   * there is no `has` trap, so `in` is false even for a real tab. The key list
   * goes through the `ownKeys` trap, which returns the CRDT object's actual
   * keys, and is equally correct on a plain object.
   *
   * It reads that list through `safeWorksheetRecordKeys` rather than raw
   * `Object.keys`, which is what that helper exists for: `ownKeys` throws
   * `TypeError: ... duplicate` on a record that ended up with duplicate CRDT
   * keys, and a tab lookup that throws would 500 every structural request on
   * such a document instead of resolving the tab.
   */
  private worksheetOrThrow(
    root: { sheets?: Record<string, unknown> },
    tabId: string,
  ) {
    const sheets = root.sheets;
    if (!sheets || !safeWorksheetRecordKeys(sheets).includes(tabId)) {
      throw new NotFoundException('Tab not found');
    }
    return sheets[tabId] as Worksheet;
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
   * Reading `root.tabs?.[tabId]` is safe only because `worksheetOrThrow` has
   * already proved `tabId` is a real key — keep the call order.
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
          const ws = this.worksheetOrThrow(root, tabId);
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
          const ws = this.worksheetOrThrow(root, tabId);
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
