import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Worksheet } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import {
  getWorksheetCell,
  getWorksheetEntries,
  initialSpreadsheetDocument,
  parseRef,
  updateWorksheetCell,
  writeWorksheetCell,
} from '@wafflebase/sheets';
import { parseCellStyle } from '../../yorkie/cell-style';
import { assertSheetDocument } from './sheet-document.util';
import { findWorksheet, worksheetOrThrow } from './worksheet-lookup.util';

@Controller(
  'api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId/cells',
)
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1CellsController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  /**
   * Reads and writes are both sheet-only, but they say so with different
   * nouns.
   *
   * The reason differs, so the wording does. A **write** would otherwise
   * create something: it passes `initialRoot`, which Yorkie applies to any
   * empty document, and `withDocument` defaults to the `sheet-` docKey prefix,
   * so a `doc` / `note` / blob id opened here is empty by construction —
   * without the guard the write seeded a spreadsheet root under `sheet-<id>`
   * and answered 200, leaving a phantom document beside the real one. A
   * **read** creates nothing; it attaches `readonly` with no seed, and used to
   * answer `404 Tab not found` because that empty document has no worksheet.
   * That was an error about the wrong noun — indistinguishable from a bad
   * `tabId` — so a caller retried tab ids for a document that was never a
   * sheet. Both are now the sibling families' `400`.
   *
   * `Cell writes` is kept verbatim: it is the wording shipped in #1019 and
   * documented in `packages/documentation/developers/rest-api.md`.
   */
  private assertSheetWrite(documentId: string, workspaceId: string) {
    return assertSheetDocument(
      this.documentService,
      'Cell writes',
      documentId,
      workspaceId,
    );
  }

  private assertSheetRead(documentId: string, workspaceId: string) {
    return assertSheetDocument(
      this.documentService,
      'Cell reads',
      documentId,
      workspaceId,
    );
  }

  @Get()
  async getCells(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Query('range') range?: string,
  ) {
    await this.assertSheetRead(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const worksheet = findWorksheet<Worksheet>(doc.getRoot(), tabId);
        if (!worksheet) throw new NotFoundException('Tab not found');

        const cells = getWorksheetEntries(worksheet).map(([ref, cell]) => ({
          ref,
          value: cell?.v ?? null,
          formula: cell?.f ?? null,
          // Spread to a plain object: a Yorkie CRDT object serializes via
          // toJSON() to a JSON *string*, so returning `cell.s` directly would
          // double-encode the style. `CellStyle` is flat, so a shallow copy is
          // enough.
          style: cell?.s ? { ...cell.s } : null,
        }));

        if (!range) return cells;

        const refs = expandRange(range);
        if (!refs) return cells;
        const refSet = new Set(refs);
        return cells.filter((c) => refSet.has(c.ref));
      },
      { syncMode: 'readonly' },
    );
  }

  @Get(':sref')
  async getCell(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Param('sref') sref: string,
  ) {
    await this.assertSheetRead(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const worksheet = findWorksheet<Worksheet>(doc.getRoot(), tabId);
        if (!worksheet) throw new NotFoundException('Tab not found');

        const cell = getWorksheetCell(worksheet, parseRef(sref));
        return {
          ref: sref,
          value: cell?.v ?? null,
          formula: cell?.f ?? null,
          // See the note in getCells: spread the Yorkie object to a plain
          // object so the style is not double-encoded as a JSON string.
          style: cell?.s ? { ...cell.s } : null,
        };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put(':sref')
  async setCell(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Param('sref') sref: string,
    @Body() body: { value?: string; formula?: string; style?: unknown },
  ) {
    await this.assertSheetWrite(documentId, workspaceId);
    // Validate the style before attaching so a bad payload 400s cheaply.
    const style =
      body.style === undefined ? undefined : parseCellStyle(body.style);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const worksheet = worksheetOrThrow<Worksheet>(root, tabId);

          const ref = parseRef(sref);
          updateWorksheetCell(worksheet, ref, (existing) => ({
            ...(existing ?? {}),
            v: body.value ?? existing?.v ?? '',
            f: body.formula ?? existing?.f,
            ...(style ? { s: { ...(existing?.s ?? {}), ...style } } : {}),
          }));
        });

        return {
          ref: sref,
          value: body.value,
          formula: body.formula,
          ...(style ? { style } : {}),
        };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  @Delete(':sref')
  async deleteCell(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Param('sref') sref: string,
  ) {
    await this.assertSheetWrite(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const worksheet = worksheetOrThrow<Worksheet>(root, tabId);
          writeWorksheetCell(worksheet, parseRef(sref), undefined);
        });

        return { ref: sref, deleted: true };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  @Patch()
  async batchUpdate(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body()
    body: {
      cells: Record<
        string,
        { value?: string; formula?: string; style?: unknown } | null
      >;
    },
  ) {
    await this.assertSheetWrite(documentId, workspaceId);
    // Validate every provided style up front so one bad style 400s before any
    // write, rather than aborting a partially-applied doc.update.
    const styles: Record<string, ReturnType<typeof parseCellStyle>> = {};
    for (const [ref, cellData] of Object.entries(body.cells)) {
      if (cellData && cellData.style !== undefined) {
        styles[ref] = parseCellStyle(cellData.style);
      }
    }
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const worksheet = worksheetOrThrow<Worksheet>(root, tabId);

          for (const [ref, cellData] of Object.entries(body.cells)) {
            const parsedRef = parseRef(ref);
            if (cellData === null) {
              writeWorksheetCell(worksheet, parsedRef, undefined);
            } else {
              const style = styles[ref];
              updateWorksheetCell(worksheet, parsedRef, (existing) => ({
                ...(existing ?? {}),
                v: cellData.value ?? existing?.v ?? '',
                f: cellData.formula ?? existing?.f,
                ...(style ? { s: { ...(existing?.s ?? {}), ...style } } : {}),
              }));
            }
          }
        });

        return { updated: Object.keys(body.cells).length };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}

/**
 * Expand a range like "A1:C3" into individual cell refs.
 * Returns null if the range format is invalid.
 */
function expandRange(range: string): string[] | null {
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;

  const startCol = colToIndex(match[1].toUpperCase());
  const startRow = parseInt(match[2], 10);
  const endCol = colToIndex(match[3].toUpperCase());
  const endRow = parseInt(match[4], 10);

  const refs: string[] = [];
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      refs.push(indexToCol(col) + row);
    }
  }
  return refs;
}

function colToIndex(col: string): number {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64);
  }
  return index;
}

function indexToCol(index: number): string {
  let col = '';
  while (index > 0) {
    const remainder = (index - 1) % 26;
    col = String.fromCharCode(65 + remainder) + col;
    index = Math.floor((index - 1) / 26);
  }
  return col;
}
