import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { DocumentService } from '../../document/document.service';
import { YorkieService } from '../../yorkie/yorkie.service';
import {
  DocsYorkieRoot,
  readDocsRoot,
  writeDocsRoot,
} from '../../yorkie/docs-tree';
import type { DocsDocument } from '../../yorkie/yorkie.types';

const DOC_KEY_PREFIX = 'doc-';

const TYPE_MISMATCH_BODY = {
  error: {
    code: 'TYPE_MISMATCH',
    message: "Use 'sheets cells get' for spreadsheet documents",
  },
};

/**
 * Read/write the canonical `Document` JSON for a word-processor document.
 *
 * Both endpoints attach to the same Yorkie document the editor uses
 * (key `doc-<documentId>`, see `packages/frontend/src/app/docs/docs-detail.tsx`).
 * The CLI consumes them so it never needs to ship a Yorkie SDK dependency.
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/content')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard)
export class ApiV1DocsContentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly yorkieService: YorkieService,
  ) {}

  // TODO(perf): each request makes two round-trips (Postgres metadata
  // lookup + Yorkie attach). If this endpoint becomes hot we can cache the
  // document type by id or short-circuit the type check when the caller is
  // already known to be a docs client.
  private async assertDocsDocument(
    workspaceId: string,
    documentId: string,
  ): Promise<void> {
    const meta = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    if (meta.type !== 'doc') {
      throw new ConflictException(TYPE_MISMATCH_BODY);
    }
  }

  @Get()
  async getContent(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ): Promise<DocsDocument> {
    await this.assertDocsDocument(workspaceId, documentId);
    return this.yorkieService.withDocument<DocsDocument, DocsYorkieRoot>(
      documentId,
      (doc) => readDocsRoot(doc.getRoot()),
      { docKeyPrefix: DOC_KEY_PREFIX, syncMode: 'readonly' },
    );
  }

  @Put()
  async putContent(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() body: DocsDocument,
  ): Promise<DocsDocument> {
    // Hand-rolled shape guard. `@Body()` is compile-time typed only, so a
    // malformed payload would otherwise reach `writeDocsRoot` and surface
    // as HTTP 500. The minimum invariant the writer needs is a `blocks`
    // array; everything beyond that is validated implicitly by the Tree
    // builder which falls back to safe defaults for unknown attributes.
    if (!body || !Array.isArray((body as { blocks?: unknown }).blocks)) {
      throw new BadRequestException(
        "Invalid docs content payload: 'blocks' must be an array",
      );
    }
    await this.assertDocsDocument(workspaceId, documentId);
    await this.yorkieService.withDocument<void, DocsYorkieRoot>(
      documentId,
      (doc) => {
        doc.update((root) => {
          writeDocsRoot(root as DocsYorkieRoot, body);
        });
      },
      { docKeyPrefix: DOC_KEY_PREFIX },
    );
    // Echo the request body back so the CLI sees "what they sent" rather
    // than a re-read of stored state. `writeDocsRoot` is currently identity
    // on the JSON shape for valid input — every field round-trips through
    // the writer/reader pair without normalization — so this is equivalent
    // to a re-read for well-formed payloads. We avoid the actual re-read
    // because Yorkie's Tree CRDT is only queryable inside an attached
    // `doc.update` callback and that would require a second attach.
    return body;
  }
}
