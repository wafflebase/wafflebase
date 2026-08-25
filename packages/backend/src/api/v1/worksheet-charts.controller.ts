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
import type { SheetChart } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { parseCharts } from '../../yorkie/worksheet-charts';

/**
 * Chart collection for a spreadsheet tab. A chart is a `SheetChart` (type,
 * source range, anchor, geometry). GET returns the charts as an array; PUT
 * replaces the whole collection (keyed by each chart's id), so omitting a
 * chart deletes it. Bodies are validated before the write and GET returns
 * plain JSON since a Yorkie value's toJSON would serialize as a string.
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1WorksheetChartsController {
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
        `Worksheet charts are only available on sheet documents; "${documentId}" is a "${doc.type}" document.`,
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

  private readCharts(source: unknown): SheetChart[] {
    const out: SheetChart[] = [];
    if (source && typeof source === 'object') {
      for (const value of Object.values(source as object)) {
        if (value && typeof value === 'object') {
          out.push({ ...(value as SheetChart) });
        }
      }
    }
    return out;
  }

  @Get('charts')
  async getCharts(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = doc.getRoot().sheets?.[tabId] as
          | { charts?: unknown }
          | undefined;
        return { charts: this.readCharts(ws?.charts) };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('charts')
  async setCharts(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const charts = parseCharts(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = this.worksheetOrThrow(root, tabId) as {
            charts?: Record<string, SheetChart>;
          };
          ws.charts = {};
          for (const chart of charts) ws.charts[chart.id] = chart;
        });
        return { charts };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
