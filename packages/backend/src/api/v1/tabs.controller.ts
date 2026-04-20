import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';

@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard)
export class ApiV1TabsController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ) {
    await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });

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
}
