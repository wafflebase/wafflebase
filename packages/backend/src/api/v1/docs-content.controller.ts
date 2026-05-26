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
import {
  SlidesYorkieRoot,
  readSlidesRoot,
  writeSlidesRoot,
} from '../../yorkie/slides-tree';
import type {
  DocsDocument,
  SlidesDocument,
} from '../../yorkie/yorkie.types';

const DOC_KEY_PREFIX = 'doc-';
const SLIDES_KEY_PREFIX = 'slides-';

const TYPE_MISMATCH_BODY = {
  error: {
    code: 'TYPE_MISMATCH',
    message: "Use 'sheets cells get' for spreadsheet documents",
  },
};

type ContentDocument = DocsDocument | SlidesDocument;

/**
 * Read/write the canonical content JSON for word-processor (`doc`) and
 * slides (`slides`) documents.
 *
 * The PUT body shape is determined by the persisted document type — the
 * controller loads the document's `type` from Postgres and dispatches to
 * the matching writer. Sheets are rejected with `TYPE_MISMATCH` because
 * they expose the `cells` endpoints instead.
 *
 * Both flows attach to the same Yorkie document the editor uses (key
 * `doc-<id>` for word-processor docs, `slides-<id>` for decks — see
 * `packages/frontend/src/app/docs/docs-detail.tsx` and
 * `packages/frontend/src/app/slides/slides-detail.tsx`). The CLI consumes
 * these endpoints so it never needs to ship a Yorkie SDK dependency.
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
  // already known to be a content-shaped client.
  private async loadContentType(
    workspaceId: string,
    documentId: string,
  ): Promise<'doc' | 'slides'> {
    const meta = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    if (meta.type !== 'doc' && meta.type !== 'slides') {
      throw new ConflictException(TYPE_MISMATCH_BODY);
    }
    return meta.type;
  }

  @Get()
  async getContent(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ): Promise<ContentDocument> {
    const type = await this.loadContentType(workspaceId, documentId);
    if (type === 'doc') {
      return this.yorkieService.withDocument<DocsDocument, DocsYorkieRoot>(
        documentId,
        (doc) => readDocsRoot(doc.getRoot()),
        { docKeyPrefix: DOC_KEY_PREFIX, syncMode: 'readonly' },
      );
    }
    return this.yorkieService.withDocument<SlidesDocument, SlidesYorkieRoot>(
      documentId,
      (doc) => readSlidesRoot(doc.getRoot()),
      { docKeyPrefix: SLIDES_KEY_PREFIX, syncMode: 'readonly' },
    );
  }

  @Put()
  async putContent(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ): Promise<ContentDocument> {
    // Hand-rolled shape guard. `@Body()` is compile-time typed only, so a
    // malformed payload would otherwise reach the writer and surface as
    // HTTP 500 deep inside Yorkie. We validate just the fields the writer
    // unconditionally dereferences. Validation runs *before* the document
    // type lookup so a totally bogus payload (e.g. `{}`) gets a 400 with a
    // useful message regardless of the target document's type — but we
    // can't pick the right validator until we know the type, so we peek
    // at the body's shape: a `blocks` array means docs, a `slides` array
    // means slides. If neither is present, we surface a single error
    // mentioning both — the caller is sending an unrecognised payload.
    const shape = sniffBodyShape(body);
    if (shape === null) {
      throw new BadRequestException(
        "Invalid content payload: must contain 'blocks' (docs) or 'slides' (slides)",
      );
    }
    if (shape === 'doc') {
      assertValidDocsBody(body);
    } else {
      assertValidSlidesBody(body);
    }
    const type = await this.loadContentType(workspaceId, documentId);
    if (type !== shape) {
      throw new BadRequestException(
        `Body shape '${shape}' does not match document type '${type}'`,
      );
    }
    // Echo the request body back so the CLI sees "what they sent" rather
    // than a re-read of stored state. Both writers are identity on the
    // JSON shape for valid input, so this is equivalent to a re-read for
    // well-formed payloads — and avoids a second Yorkie attach.
    if (type === 'doc') {
      await this.yorkieService.withDocument<void, DocsYorkieRoot>(
        documentId,
        (doc) => {
          doc.update((root) => {
            writeDocsRoot(root as DocsYorkieRoot, body as DocsDocument);
          });
        },
        { docKeyPrefix: DOC_KEY_PREFIX },
      );
      return body as DocsDocument;
    }
    await this.yorkieService.withDocument<void, SlidesYorkieRoot>(
      documentId,
      (doc) => {
        doc.update((root) => {
          writeSlidesRoot(root as SlidesYorkieRoot, body as SlidesDocument);
        });
      },
      { docKeyPrefix: SLIDES_KEY_PREFIX },
    );
    return body as SlidesDocument;
  }
}

/**
 * Pick the validator + writer arm based on the *body's* shape rather
 * than the document's persisted type. Returns `null` if neither anchor
 * field is recognisable; the caller surfaces this as a 400.
 */
function sniffBodyShape(body: unknown): 'doc' | 'slides' | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  // `slides` is the unambiguous anchor for slides decks — docs bodies
  // never carry a `slides` array. Once we've routed to the slides arm,
  // `assertValidSlidesBody` validates the rest of the payload (including
  // `meta` and the other required arrays).
  if (Array.isArray(b.slides)) return 'slides';
  if (Array.isArray(b.blocks)) return 'doc';
  return null;
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

/**
 * Validate the top-level shape of a `SlidesDocument`. We only check what
 * `writeSlidesRoot` dereferences (`meta.{title,themeId,masterId}`,
 * `themes`/`masters`/`layouts`/`slides` arrays, plus the minimal shape of
 * each slide) so a clearly malformed payload returns a 400 instead of a
 * 500 from inside the Yorkie assignment.
 */
function assertValidSlidesBody(body: unknown): asserts body is SlidesDocument {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException(
      'Invalid slides content payload: not an object',
    );
  }
  const b = body as Record<string, unknown>;
  const meta = b.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== 'object') {
    throw new BadRequestException(
      "Invalid slides content payload: 'meta' must be an object",
    );
  }
  for (const key of ['title', 'themeId', 'masterId'] as const) {
    if (typeof meta[key] !== 'string' || (meta[key] as string).length === 0) {
      throw new BadRequestException(
        `Invalid slides content payload: 'meta.${key}' must be a non-empty string`,
      );
    }
  }
  for (const arr of ['themes', 'masters', 'layouts', 'slides'] as const) {
    if (!Array.isArray(b[arr])) {
      throw new BadRequestException(
        `Invalid slides content payload: '${arr}' must be an array`,
      );
    }
  }
  const slides = b.slides as unknown[];
  for (let i = 0; i < slides.length; i++) {
    assertValidSlide(slides[i], `slides[${i}]`);
  }
}

function assertValidSlide(slide: unknown, path: string): void {
  if (!slide || typeof slide !== 'object') {
    throw new BadRequestException(`Invalid slide at ${path}: not an object`);
  }
  const s = slide as Record<string, unknown>;
  if (typeof s.id !== 'string' || s.id.length === 0) {
    throw new BadRequestException(
      `Invalid slide at ${path}: 'id' must be a non-empty string`,
    );
  }
  if (typeof s.layoutId !== 'string' || s.layoutId.length === 0) {
    throw new BadRequestException(
      `Invalid slide at ${path}: 'layoutId' must be a non-empty string`,
    );
  }
  if (!s.background || typeof s.background !== 'object') {
    throw new BadRequestException(
      `Invalid slide at ${path}: 'background' must be an object`,
    );
  }
  if (!Array.isArray(s.elements)) {
    throw new BadRequestException(
      `Invalid slide at ${path}: 'elements' must be an array`,
    );
  }
  if (!Array.isArray(s.notes)) {
    throw new BadRequestException(
      `Invalid slide at ${path}: 'notes' must be an array`,
    );
  }
  // Per-element shape check. The frontend's `migrateElement` cleans up
  // most malformed elements at read time, but a totally bogus entry
  // (missing `type` or `frame`) breaks renderer assumptions. Block
  // those at the boundary so they never reach Yorkie.
  for (let i = 0; i < s.elements.length; i++) {
    assertValidElement(s.elements[i], `${path}.elements[${i}]`);
  }
}

function assertValidElement(element: unknown, path: string): void {
  if (!element || typeof element !== 'object') {
    throw new BadRequestException(`Invalid element at ${path}: not an object`);
  }
  const e = element as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id.length === 0) {
    throw new BadRequestException(
      `Invalid element at ${path}: 'id' must be a non-empty string`,
    );
  }
  if (typeof e.type !== 'string') {
    throw new BadRequestException(
      `Invalid element at ${path}: 'type' must be a string`,
    );
  }
  if (!e.frame || typeof e.frame !== 'object') {
    throw new BadRequestException(
      `Invalid element at ${path}: 'frame' must be an object`,
    );
  }
}
