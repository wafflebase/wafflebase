import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { createTab, resolveRename } from '../../yorkie/tab-ops';
import { initialSpreadsheetDocument } from '@wafflebase/sheets';

@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1TabsController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  /**
   * Workspace membership AND document type.
   *
   * The type check is not cosmetic. `withDocument` defaults to the `sheet-`
   * docKey prefix, so a `doc`/`slides`/`pdf` document reaching here does not
   * open ITS Yorkie document — it attaches an empty one under `sheet-<id>`
   * that no editor will ever open. `list` would then report zero tabs for a
   * document that has content, and `create` would throw on `root.tabs[tabId]`
   * (undefined on a fresh root) after having already created that phantom.
   */
  private async assertSheetDocument(documentId: string, workspaceId: string) {
    const doc = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });

    if (doc.type !== 'sheet') {
      throw new BadRequestException(
        `Tabs are only available on sheet documents; "${documentId}" is a "${doc.type}" document.`,
      );
    }

    return doc;
  }

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);

    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const root = doc.getRoot();
        const tabOrder = root.tabOrder ?? [];
        const tabs = root.tabs ?? {};

        return tabOrder.map((tabId: string) => {
          const tab = tabs[tabId];
          return {
            id: tabId,
            name: tab?.name ?? tabId,
            type: tab?.type ?? 'sheet',
            kind: tab?.kind,
          };
        });
      },
      { syncMode: 'readonly' },
    );
  }

  @Post()
  async create(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() body: { name?: string; type?: string },
  ) {
    await this.assertSheetDocument(documentId, workspaceId);

    if (body?.type !== undefined && body.type !== 'sheet') {
      throw new BadRequestException(
        `Unsupported tab type "${body.type}"; only "sheet" is supported.`,
      );
    }

    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        let result: { id: string; name: string; type: string } | undefined;
        doc.update((root) => {
          result = createTab(root, { name: body?.name });
        });
        return result;
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  @Patch(':tabId')
  async rename(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: { name?: string },
  ) {
    await this.assertSheetDocument(documentId, workspaceId);

    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const resolution = resolveRename(
          doc.getRoot().tabs ?? {},
          tabId,
          body?.name ?? '',
        );

        if (!resolution.ok) {
          switch (resolution.reason) {
            case 'not_found':
              throw new NotFoundException('Tab not found');
            case 'blank':
              throw new BadRequestException('name is required');
            case 'conflict':
              throw new ConflictException(
                `Tab name "${(body?.name ?? '').trim()}" already exists.`,
              );
          }
        }

        doc.update((root) => {
          const tab = root.tabs?.[tabId];
          if (tab) tab.name = resolution.name;
        });

        return { id: tabId, name: resolution.name, type: resolution.type };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
