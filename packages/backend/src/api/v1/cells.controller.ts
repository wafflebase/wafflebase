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
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import type { Sref } from '@wafflebase/sheet';

@Controller(
  'api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId/cells',
)
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard)
export class ApiV1CellsController {
  constructor(private readonly yorkieService: YorkieService) {}

  @Get()
  async getCells(
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Query('range') range?: string,
  ) {
    return this.yorkieService.withDocument(documentId, (doc) => {
      const root = doc.getRoot();
      const worksheet = root.sheets?.[tabId];
      if (!worksheet) throw new NotFoundException('Tab not found');

      const sheet = worksheet.sheet ?? {};
      const cells = Object.entries(sheet).map(([ref, cell]) => ({
        ref,
        value: cell?.v ?? null,
        formula: cell?.f ?? null,
        style: cell?.s ?? null,
      }));

      if (!range) return cells;

      const refs = expandRange(range);
      if (!refs) return cells;
      const refSet = new Set(refs);
      return cells.filter((c) => refSet.has(c.ref));
    });
  }

  @Get(':sref')
  async getCell(
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Param('sref') sref: string,
  ) {
    return this.yorkieService.withDocument(documentId, (doc) => {
      const root = doc.getRoot();
      const worksheet = root.sheets?.[tabId];
      if (!worksheet) throw new NotFoundException('Tab not found');

      const cell = worksheet.sheet?.[sref as Sref];
      return {
        ref: sref,
        value: cell?.v ?? null,
        formula: cell?.f ?? null,
        style: cell?.s ?? null,
      };
    });
  }

  @Put(':sref')
  async setCell(
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Param('sref') sref: string,
    @Body() body: { value?: string; formula?: string },
  ) {
    return this.yorkieService.withDocument(documentId, (doc) => {
      doc.update((root) => {
        const worksheet = root.sheets?.[tabId];
        if (!worksheet) throw new NotFoundException('Tab not found');

        if (!worksheet.sheet) {
          worksheet.sheet = {} as any;
        }
        const existing = worksheet.sheet[sref as Sref] ?? {};
        worksheet.sheet[sref as Sref] = {
          ...existing,
          v: body.value ?? existing.v ?? '',
          f: body.formula ?? existing.f,
        } as any;
      });

      return { ref: sref, value: body.value, formula: body.formula };
    });
  }

  @Delete(':sref')
  async deleteCell(
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Param('sref') sref: string,
  ) {
    return this.yorkieService.withDocument(documentId, (doc) => {
      doc.update((root) => {
        const worksheet = root.sheets?.[tabId];
        if (!worksheet) throw new NotFoundException('Tab not found');
        if (worksheet.sheet) {
          delete worksheet.sheet[sref as Sref];
        }
      });

      return { ref: sref, deleted: true };
    });
  }

  @Patch()
  async batchUpdate(
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: { cells: Record<string, { value?: string; formula?: string } | null> },
  ) {
    return this.yorkieService.withDocument(documentId, (doc) => {
      doc.update((root) => {
        const worksheet = root.sheets?.[tabId];
        if (!worksheet) throw new NotFoundException('Tab not found');
        if (!worksheet.sheet) {
          worksheet.sheet = {} as any;
        }

        for (const [ref, cellData] of Object.entries(body.cells)) {
          if (cellData === null) {
            delete worksheet.sheet[ref as Sref];
          } else {
            const existing = worksheet.sheet[ref as Sref] ?? {};
            worksheet.sheet[ref as Sref] = {
              ...existing,
              v: cellData.value ?? existing.v ?? '',
              f: cellData.formula ?? existing.f,
            } as any;
          }
        }
      });

      return { updated: Object.keys(body.cells).length };
    });
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
