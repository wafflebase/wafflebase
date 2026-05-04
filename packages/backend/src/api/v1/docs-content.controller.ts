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
    // as HTTP 500 deep inside the Yorkie tree builder. We validate just
    // the fields the builder unconditionally dereferences (`id`, `type`,
    // `style`, plus the `inlines` array on non-table blocks and
    // `tableData` on tables). Everything beyond that — heading level,
    // list kind, cell merge spans — is optional and flows through with
    // safe defaults.
    assertValidDocsBody(body);
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

/**
 * Throw a 400 with the offending block path on the first shape problem
 * we find. Stops at the first failure to keep the response small —
 * fix-and-retry workflows don't gain much from a list of every error.
 */
function assertValidDocsBody(body: unknown): asserts body is DocsDocument {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Invalid docs content payload: not an object');
  }
  const blocks = (body as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) {
    throw new BadRequestException(
      "Invalid docs content payload: 'blocks' must be an array",
    );
  }
  for (let i = 0; i < blocks.length; i++) {
    assertValidBlock(blocks[i], `blocks[${i}]`);
  }
}

function assertValidBlock(block: unknown, path: string): void {
  if (!block || typeof block !== 'object') {
    throw new BadRequestException(`Invalid block at ${path}: not an object`);
  }
  const b = block as Record<string, unknown>;
  if (typeof b.id !== 'string' || b.id.length === 0) {
    throw new BadRequestException(`Invalid block at ${path}: 'id' must be a non-empty string`);
  }
  if (typeof b.type !== 'string') {
    throw new BadRequestException(`Invalid block at ${path}: 'type' must be a string`);
  }
  if (!b.style || typeof b.style !== 'object') {
    throw new BadRequestException(`Invalid block at ${path}: 'style' must be an object`);
  }
  if (b.type === 'table') {
    const td = b.tableData as Record<string, unknown> | undefined;
    if (!td || typeof td !== 'object') {
      throw new BadRequestException(`Invalid block at ${path}: 'tableData' is required for type:'table'`);
    }
    if (!Array.isArray(td.columnWidths)) {
      throw new BadRequestException(`Invalid block at ${path}: 'tableData.columnWidths' must be an array`);
    }
    if (!Array.isArray(td.rows)) {
      throw new BadRequestException(`Invalid block at ${path}: 'tableData.rows' must be an array`);
    }
    for (let r = 0; r < td.rows.length; r++) {
      const row = td.rows[r] as { cells?: unknown };
      if (!row || !Array.isArray(row.cells)) {
        throw new BadRequestException(
          `Invalid block at ${path}.tableData.rows[${r}]: 'cells' must be an array`,
        );
      }
      for (let c = 0; c < row.cells.length; c++) {
        const cell = row.cells[c] as { blocks?: unknown };
        if (!cell || !Array.isArray(cell.blocks)) {
          throw new BadRequestException(
            `Invalid block at ${path}.tableData.rows[${r}].cells[${c}]: 'blocks' must be an array`,
          );
        }
        for (let cb = 0; cb < cell.blocks.length; cb++) {
          assertValidBlock(
            cell.blocks[cb],
            `${path}.tableData.rows[${r}].cells[${c}].blocks[${cb}]`,
          );
        }
      }
    }
    return;
  }
  if (!Array.isArray(b.inlines)) {
    throw new BadRequestException(`Invalid block at ${path}: 'inlines' must be an array`);
  }
}
