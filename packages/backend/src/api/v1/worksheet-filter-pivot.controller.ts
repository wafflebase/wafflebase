import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { initialSpreadsheetDocument } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { detachYorkieValue } from '../../yorkie/yorkie-json';
import {
  parseFilter,
  parsePivot,
} from '../../yorkie/worksheet-filter-pivot';

/**
 * Worksheet-level filter and pivot for a spreadsheet tab. Each is a single
 * object field (`filter` / `pivotTable`); a PUT validates and replaces it (or
 * clears it with `null`), and a GET returns it as plain JSON via
 * `detachYorkieValue` (a nested Yorkie value's toJSON would serialize as a
 * string otherwise).
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1WorksheetFilterPivotController {
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
        `Filter and pivot are only available on sheet documents; "${documentId}" is a "${doc.type}" document.`,
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
    return worksheet as Record<string, unknown>;
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
        const ws = doc.getRoot().sheets?.[tabId] as
          | { filter?: unknown }
          | undefined;
        return { filter: ws?.filter ? detachYorkieValue(ws.filter) : null };
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
          const ws = this.worksheetOrThrow(root, tabId);
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
        const ws = doc.getRoot().sheets?.[tabId] as
          | { pivotTable?: unknown }
          | undefined;
        return {
          pivot: ws?.pivotTable ? detachYorkieValue(ws.pivotTable) : null,
        };
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
          const ws = this.worksheetOrThrow(root, tabId);
          if (pivot === null) delete ws.pivotTable;
          else ws.pivotTable = pivot;
        });
        return { pivot };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
