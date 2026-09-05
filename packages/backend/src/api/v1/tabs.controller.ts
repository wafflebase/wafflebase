import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
import {
  TabResult,
  applyDelete,
  applyMove,
  createTab,
  duplicateTab,
  resolveDelete,
  resolveMove,
  resolveRename,
} from '../../yorkie/tab-ops';
import { unwrapJson } from '../../yorkie/yorkie-json';
import { assertSheetDocument } from './sheet-document.util';
import { findWorksheet } from './worksheet-lookup.util';
import {
  initialSpreadsheetDocument,
  safeWorksheetRecordKeys,
} from '@wafflebase/sheets';
import type { Worksheet } from '@wafflebase/sheets';

@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1TabsController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  /**
   * Workspace membership AND document type — see `sheet-document.util.ts` for
   * why the type check is not cosmetic.
   *
   * What it costs this family specifically: without it `list` reports zero
   * tabs for a document that has content (it read the empty `sheet-<id>`
   * attach, not the real one), and `create` throws on `root.tabs[tabId]`
   * (undefined on a fresh root) after having already created that phantom.
   */
  private assertSheetDocument(documentId: string, workspaceId: string) {
    return assertSheetDocument(
      this.documentService,
      'Tabs',
      documentId,
      workspaceId,
    );
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

  @Delete(':tabId')
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);

    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const resolution = resolveDelete(doc.getRoot(), tabId);
        if (!resolution.ok) {
          switch (resolution.reason) {
            case 'not_found':
              throw new NotFoundException('Tab not found');
            case 'last_tab':
              throw new ConflictException(
                'A spreadsheet must keep at least one tab; delete the ' +
                  'document instead of its last tab.',
              );
            case 'pivot_dependents':
              throw new ConflictException(
                `Tab "${tabId}" is the source of pivot output tab(s) ` +
                  `${resolution.dependents.join(', ')}. Delete those first.`,
              );
          }
        }

        doc.update((root) => {
          applyDelete(root, tabId);
        });
        return { id: tabId, name: resolution.name, deleted: true };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  /**
   * Reorder a tab in the tab bar, NOT `POST .../tabs/:tabId/move`.
   *
   * `ApiV1WorksheetStructureController` is mounted one segment deeper
   * (`.../tabs/:tabId`) and already owns `move` there, for the row/column axis
   * move. `:tabId/move` here resolves to the very same Express path, and since
   * this controller is registered first in `api-v1.module.ts` it would shadow
   * that endpoint entirely — a `{ axis, srcIndex, count, dstIndex }` body would
   * reach this handler and 400 on the missing `index`. The axis move is the
   * older, published route, so the tab reorder is the one that takes another
   * verb.
   */
  @Post(':tabId/reorder')
  async move(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: { index?: unknown },
  ) {
    await this.assertSheetDocument(documentId, workspaceId);

    const index = body?.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1) {
      throw new BadRequestException(
        "'index' must be a positive integer (1 = first tab)",
      );
    }

    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const resolution = resolveMove(doc.getRoot(), tabId, index);
        if (!resolution.ok) throw new NotFoundException('Tab not found');

        doc.update((root) => {
          applyMove(root, resolution.from, resolution.to);
        });
        return { id: tabId, index: resolution.to + 1 };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }

  @Post(':tabId/duplicate')
  async duplicate(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: { name?: string },
  ) {
    await this.assertSheetDocument(documentId, workspaceId);

    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const root = doc.getRoot();
        // Resolved against the record's real keys, not by truthiness: on a
        // plain root `tabs['__proto__']` is `Object.prototype` and on a live
        // Yorkie proxy `tabs['toJSON']` is a function — both truthy, and the
        // duplicate below would then be keyed off a non-tab.
        if (!safeWorksheetRecordKeys(root.tabs).includes(tabId)) {
          throw new NotFoundException('Tab not found');
        }
        // Detach the source worksheet from the CRDT proxy before it is
        // written back as a new entry: assigning a proxy into another key
        // would store Yorkie's own `toJSON` string rather than a grid.
        const worksheet = unwrapJson<Worksheet>(findWorksheet(root, tabId));
        if (!worksheet) {
          throw new BadRequestException(
            `Tab "${tabId}" has no worksheet to duplicate; only sheet tabs ` +
              'can be duplicated.',
          );
        }

        let result: TabResult | undefined;
        doc.update((r) => {
          result = duplicateTab(r, tabId, worksheet, body?.name);
        });
        return result;
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
