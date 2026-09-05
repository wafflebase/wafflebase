import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { initialSpreadsheetDocument } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { assertSheetDocument } from './sheet-document.util';
import { unwrapJson } from '../../yorkie/yorkie-json';
import { parseFilter, parsePivot } from '../../yorkie/worksheet-filter-pivot';
import { findWorksheet, worksheetOrThrow } from './worksheet-lookup.util';

/**
 * Worksheet-level filter and pivot for a spreadsheet tab. Each is a single
 * object field (`filter` / `pivotTable`); a PUT validates and replaces it (or
 * clears it with `null`), and a GET returns it as plain JSON via `unwrapJson`
 * (a nested Yorkie value's toJSON would serialize as a string otherwise).
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1WorksheetFilterPivotController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  private assertSheetDocument(documentId: string, workspaceId: string) {
    return assertSheetDocument(
      this.documentService,
      'Filter and pivot',
      documentId,
      workspaceId,
    );
  }

  @Get('filter')
  async getFilter(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = findWorksheet<{ filter?: unknown }>(doc.getRoot(), tabId);
        // `unwrapJson`, not `detachYorkieValue`: the object proxy's own
        // `toJSON` walks the CRDT and detaches every nested value, arrays
        // included. `detachYorkieValue` branches on `Array.isArray`, which is
        // false for a Yorkie array proxy, so nested arrays (e.g. a column's
        // hidden-value list) come back as `{createdAt, movedAt}` CRDT
        // metadata. Same reasoning as `readSlidesRoot` in `slides-tree.ts`.
        return { filter: unwrapJson(ws?.filter) ?? null };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('filter')
  async setFilter(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const filter = parseFilter(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = worksheetOrThrow(root, tabId);
          if (filter === null) delete ws.filter;
          else ws.filter = filter;
        });
        return { filter };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  @Get('pivot')
  async getPivot(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = findWorksheet<{ pivotTable?: unknown }>(
          doc.getRoot(),
          tabId,
        );
        // `unwrapJson`, not `detachYorkieValue` — see `getFilter`. Here it is
        // the four field arrays (`rowFields` / `columnFields` / `valueFields`
        // / `filterFields`) that a proxy walk would flatten into CRDT
        // metadata objects instead of arrays.
        return { pivot: unwrapJson(ws?.pivotTable) ?? null };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('pivot')
  async setPivot(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const pivot = parsePivot(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = worksheetOrThrow(root, tabId);
          if (pivot === null) delete ws.pivotTable;
          else ws.pivotTable = pivot;
        });
        return { pivot };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
