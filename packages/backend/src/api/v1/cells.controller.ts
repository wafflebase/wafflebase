import {
  BadRequestException,
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

@Controller(
  'api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId/cells',
)
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1CellsController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  private async assertDocumentInWorkspace(
    documentId: string,
    workspaceId: string,
  ) {
    await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
  }

  /**
   * Cell writes are only meaningful on a sheet document.
   *
   * The read handlers attach `readonly` with no seed, so a non-sheet id costs
   * nothing there and answers `404 Tab not found`. The write verbs pass
   * `initialRoot`, which Yorkie applies to any *empty* document — and
   * `withDocument` defaults to the `sheet-` docKey prefix, so a `doc` / `note`
   * / `pdf` id opened here is empty by construction. Without this check a
   * write to `.../documents/<a doc id>/tabs/tab-1/cells/A1` seeded a canonical
   * spreadsheet root, stored the cell in it and answered 200, leaving a
   * permanent `sheet-<id>` document beside the real `doc-<id>` one that
   * subsequent reads on the same id then served back — self-consistent, and
   * invisible to the editor that owns the id.
   *
   * 400 with the sibling worksheet controllers' wording: the request is
   * well-formed, it is the document that cannot take it.
   */
  private async assertSheetDocument(documentId: string, workspaceId: string) {
    const doc = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    if (doc.type !== 'sheet') {
      throw new BadRequestException(
        `Cell writes are only available on sheet documents; "${documentId}" is a "${doc.type}" document.`,
      );
    }
    return doc;
  }

  @Get()
  async getCells(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Query('range') range?: string,
  ) {
    await this.assertDocumentInWorkspace(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const root = doc.getRoot();
        const worksheet = root.sheets?.[tabId];
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
    await this.assertDocumentInWorkspace(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const root = doc.getRoot();
        const worksheet = root.sheets?.[tabId];
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
    await this.assertSheetDocument(documentId, workspaceId);
    // Validate the style before attaching so a bad payload 400s cheaply.
    const style =
      body.style === undefined ? undefined : parseCellStyle(body.style);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const worksheet = root.sheets?.[tabId];
          if (!worksheet) throw new NotFoundException('Tab not found');

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
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const worksheet = root.sheets?.[tabId];
          if (!worksheet) throw new NotFoundException('Tab not found');
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
    await this.assertSheetDocument(documentId, workspaceId);
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
          const worksheet = root.sheets?.[tabId];
          if (!worksheet) throw new NotFoundException('Tab not found');

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
