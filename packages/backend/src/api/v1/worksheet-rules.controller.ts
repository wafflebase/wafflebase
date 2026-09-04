import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  initialSpreadsheetDocument,
  normalizeConditionalFormatRule,
  normalizeDataValidationRule,
} from '@wafflebase/sheets';
import type {
  ConditionalFormatRule,
  DataValidationRule,
} from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { assertSheetDocument } from './sheet-document.util';
import {
  parseConditionalFormats,
  parseDataValidations,
} from '../../yorkie/worksheet-rules';

/**
 * Worksheet-level rules for a spreadsheet tab: conditional formats and data
 * validations. Both are rule arrays on the worksheet. A PUT validates each rule
 * with the sheets-engine normalizer and replaces the array; a GET maps the
 * stored rules back through the normalizer, which both drops any stale invalid
 * rule and materializes plain JSON (a Yorkie value's toJSON would otherwise
 * serialize the array as a string).
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1WorksheetRulesController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  private assertSheetDocument(documentId: string, workspaceId: string) {
    return assertSheetDocument(
      this.documentService,
      'Worksheet rules',
      documentId,
      workspaceId,
    );
  }

  private worksheetOrThrow(
    root: { sheets?: Record<string, unknown> },
    tabId: string,
  ) {
    const worksheet = root.sheets?.[tabId];
    if (!worksheet) throw new NotFoundException('Tab not found');
    return worksheet as Record<string, unknown>;
  }

  @Get('conditional-formats')
  async getConditionalFormats(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = doc.getRoot().sheets?.[tabId] as
          | { conditionalFormats?: ConditionalFormatRule[] }
          | undefined;
        const rules = (ws?.conditionalFormats ?? [])
          .map((r) => normalizeConditionalFormatRule(r))
          .filter((r): r is ConditionalFormatRule => Boolean(r));
        return { rules };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('conditional-formats')
  async setConditionalFormats(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const rules = parseConditionalFormats(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          this.worksheetOrThrow(root, tabId).conditionalFormats = rules;
        });
        return { rules };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  @Get('data-validations')
  async getDataValidations(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = doc.getRoot().sheets?.[tabId] as
          | { dataValidations?: DataValidationRule[] }
          | undefined;
        const rules = (ws?.dataValidations ?? [])
          .map((r) => normalizeDataValidationRule(r))
          .filter((r): r is DataValidationRule => Boolean(r));
        return { rules };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('data-validations')
  async setDataValidations(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const rules = parseDataValidations(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          this.worksheetOrThrow(root, tabId).dataValidations = rules;
        });
        return { rules };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
