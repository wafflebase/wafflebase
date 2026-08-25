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
  getWorksheetCell,
  initialSpreadsheetDocument,
  toRefsFromRanges,
  writeWorksheetCell,
} from '@wafflebase/sheets';
import type { Worksheet } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { parseClearRange } from '../../yorkie/worksheet-structure';

/**
 * Structural cell operations for a spreadsheet tab. Currently exposes
 * clear-range, which removes every cell inside a range while leaving the row
 * and column structure intact. (Insert/delete/move rows and columns require
 * the shared shift/move engine and are tracked separately.)
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
}
