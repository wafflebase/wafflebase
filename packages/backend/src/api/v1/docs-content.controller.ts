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
import {
  NoteDocument,
  NoteYorkieRoot,
  readNoteRoot,
  writeNoteRoot,
} from '../../yorkie/note-content';
import type {
  DocsDocument,
  SlidesDocument,
} from '../../yorkie/yorkie.types';

import {
  BLOCK_ALIGNMENTS,
  BLOCK_STYLE_NUMERIC_FIELDS,
  isBlockAlignment,
} from '@wafflebase/docs';

import { YORKIE_DOC_KEY_PREFIXES } from '../../yorkie/yorkie-doc-key';

const DOC_KEY_PREFIX = YORKIE_DOC_KEY_PREFIXES.doc;
const SLIDES_KEY_PREFIX = YORKIE_DOC_KEY_PREFIXES.slides;
const NOTE_KEY_PREFIX = YORKIE_DOC_KEY_PREFIXES.note;

const TYPE_MISMATCH_BODY = {
  error: {
    code: 'TYPE_MISMATCH',
    message: "Use 'sheets cells get' for spreadsheet documents",
  },
};

type ContentDocument = DocsDocument | SlidesDocument | NoteDocument;

/**
 * Read/write the canonical content JSON for word-processor (`doc`), slides
 * (`slides`), and note (`note`) documents.
 *
 * The PUT body shape is determined by the persisted document type — the
 * controller loads the document's `type` from Postgres and dispatches to
 * the matching writer. Sheets are rejected with `TYPE_MISMATCH` because
 * they expose the `cells` endpoints instead.
 *
 * All flows attach to the same Yorkie document the editor uses (key
 * `doc-<id>` for word-processor docs, `slides-<id>` for decks, `note-<id>`
 * for notes — see `packages/frontend/src/app/docs/docs-detail.tsx`,
 * `packages/frontend/src/app/slides/slides-detail.tsx`, and
 * `packages/frontend/src/app/notes/notes-detail.tsx`). The CLI consumes
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
  ): Promise<'doc' | 'slides' | 'note'> {
    const meta = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    if (meta.type !== 'doc' && meta.type !== 'slides' && meta.type !== 'note') {
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
    if (type === 'note') {
      return this.yorkieService.withDocument<NoteDocument, NoteYorkieRoot>(
        documentId,
        (doc) => readNoteRoot(doc.getRoot()),
        { docKeyPrefix: NOTE_KEY_PREFIX, syncMode: 'readonly' },
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
        "Invalid content payload: must contain 'blocks' (docs), 'slides' (slides), or 'content' (note)",
      );
    }
    if (shape === 'doc') {
      assertValidDocsBody(body);
    } else if (shape === 'note') {
      assertValidNoteBody(body);
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
    if (type === 'note') {
      await this.yorkieService.withDocument<void, NoteYorkieRoot>(
        documentId,
        (doc) => {
          doc.update((root) => {
            writeNoteRoot(root as NoteYorkieRoot, body as NoteDocument);
          });
        },
        { docKeyPrefix: NOTE_KEY_PREFIX },
      );
      return body as NoteDocument;
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
function sniffBodyShape(body: unknown): 'doc' | 'slides' | 'note' | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  // `slides` is the unambiguous anchor for slides decks — docs bodies
  // never carry a `slides` array. Once we've routed to the slides arm,
  // `assertValidSlidesBody` validates the rest of the payload (including
  // `meta` and the other required arrays).
  if (Array.isArray(b.slides)) return 'slides';
  if (Array.isArray(b.blocks)) return 'doc';
  // A note body is just `{ content: <markdown string> }`. Checked last so
  // the array anchors above win; docs/slides bodies never carry a
  // top-level string `content` field.
  if (typeof b.content === 'string') return 'note';
  return null;
}

/**
 * Throw a 400 with the offending block path on the first shape problem
 * we find. Stops at the first failure to keep the response small —
 * fix-and-retry workflows don't gain much from a list of every error.
 */
/**
 * A note payload is minimal: `{ content: string }`. The whole markdown doc
 * lives in one string, so there is nothing else to validate.
 */
function assertValidNoteBody(body: unknown): asserts body is NoteDocument {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException(
      'Invalid note content payload: not an object',
    );
  }
  if (typeof (body as { content?: unknown }).content !== 'string') {
    throw new BadRequestException(
      "Invalid note content payload: 'content' must be a string",
    );
  }
}

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
  // `writeDocsRoot` persists `header.blocks` / `footer.blocks` through the
  // very same `buildBlockNode`, so a payload that smuggles a malformed block
  // (or an out-of-range alignment) into a header would otherwise bypass every
  // check above and surface as a 500 from inside Yorkie. Validate both
  // regions with the same walker, and their `marginFromEdge` too — the writer
  // reads it verbatim.
  assertValidHeaderFooter((body as { header?: unknown }).header, 'header');
  assertValidHeaderFooter((body as { footer?: unknown }).footer, 'footer');
}

function assertValidHeaderFooter(region: unknown, path: string): void {
  if (region === undefined || region === null) return;
  if (typeof region !== 'object') {
    throw new BadRequestException(
      `Invalid docs content payload: '${path}' must be an object`,
    );
  }
  const r = region as Record<string, unknown>;
  if (!Array.isArray(r.blocks)) {
    throw new BadRequestException(
      `Invalid docs content payload: '${path}.blocks' must be an array`,
    );
  }
  if (
    r.marginFromEdge !== undefined &&
    (typeof r.marginFromEdge !== 'number' ||
      !Number.isFinite(r.marginFromEdge))
  ) {
    throw new BadRequestException(
      `Invalid docs content payload: '${path}.marginFromEdge' must be a finite number`,
    );
  }
  for (let i = 0; i < r.blocks.length; i++) {
    assertValidBlock(r.blocks[i], `${path}.blocks[${i}]`);
  }
}

/**
 * Validate the *values* a block style carries, not just its shape. Every
 * field is optional (`style: {}` is a valid partial the reader fills from
 * `DEFAULT_BLOCK_STYLE`), but a present field has to be something the writer
 * can express: `alignment` reaches an OOXML attribute via the DOCX exporter,
 * and the geometry fields reach the layout engine as numbers. The writer
 * drops what it cannot express and the exporters clamp at their own sinks, so
 * this is defence in depth — its job is to hand the caller a 400 instead of
 * silently rewriting their style. Reached for body, header, footer and
 * table-cell blocks alike, since `assertValidBlock` recurses into cells — and
 * for the block styles inside slide text bodies, which are the same
 * `BlockStyle` shape reaching the same layout engine (see
 * `assertValidTextBodyBlocks`).
 *
 * The alignment allowlist is the same set the CRDT codec
 * (`@wafflebase/docs` `model/crdt-attrs.ts`) will emit and read back, so a
 * `GET` → edit → `PUT` round-trip of a docs document can never hit this 400:
 * the reader drops anything outside the set before the caller ever sees it.
 */
function assertValidBlockStyle(
  style: Record<string, unknown>,
  path: string,
): void {
  if (
    style.alignment !== undefined &&
    (typeof style.alignment !== 'string' ||
      !isBlockAlignment(style.alignment))
  ) {
    throw new BadRequestException(
      `Invalid block at ${path}: 'style.alignment' must be one of ${BLOCK_ALIGNMENTS.join(', ')}`,
    );
  }
  for (const field of BLOCK_STYLE_NUMERIC_FIELDS) {
    const value = style[field as string];
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isFinite(value))
    ) {
      throw new BadRequestException(
        `Invalid block at ${path}: 'style.${field}' must be a finite number`,
      );
    }
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
  assertValidBlockStyle(b.style as Record<string, unknown>, path);
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
        const cell = row.cells[c] as { blocks?: unknown; style?: unknown };
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
        // `serializeCellStyle` dereferences `cell.style` unconditionally, so
        // a cell without one is a 500 from inside the writer rather than a
        // 400 here. Checked after the nested blocks so the innermost problem
        // is still the one reported.
        if (!cell.style || typeof cell.style !== 'object') {
          throw new BadRequestException(
            `Invalid block at ${path}.tableData.rows[${r}].cells[${c}]: 'style' must be an object`,
          );
        }
      }
    }
    return;
  }
  if (!Array.isArray(b.inlines)) {
    throw new BadRequestException(`Invalid block at ${path}: 'inlines' must be an array`);
  }
  // `buildInlineNode` reads `inline.text.length` and `serializeInlineStyle`
  // reads every key off `inline.style`, both unconditionally — an element
  // missing either turns a malformed PUT into a 500 from inside the writer.
  for (let i = 0; i < b.inlines.length; i++) {
    const inline = b.inlines[i] as { text?: unknown; style?: unknown } | null;
    if (!inline || typeof inline !== 'object') {
      throw new BadRequestException(
        `Invalid block at ${path}.inlines[${i}]: not an object`,
      );
    }
    if (typeof inline.text !== 'string') {
      throw new BadRequestException(
        `Invalid block at ${path}.inlines[${i}]: 'text' must be a string`,
      );
    }
    if (!inline.style || typeof inline.style !== 'object') {
      throw new BadRequestException(
        `Invalid block at ${path}.inlines[${i}]: 'style' must be an object`,
      );
    }
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
  // Slide text lives in docs `Block`s — the *same* shape the docs arm
  // validates above, read back by `packages/slides` through the same
  // `normalizeBlockStyle` (a bare spread) and laid out by the same docs
  // layout engine. `writeSlidesRoot` stores them as plain JSON verbatim, so
  // without this walk the slides arm of this endpoint is a hole through which
  // a `NaN` margin or an alignment no renderer knows reaches the deck.
  const data = e.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') return;
  if (e.type === 'text') {
    assertValidTextBodyBlocks(data, `${path}.data`);
  } else if (e.type === 'shape') {
    // A shape's inline text body is lazily created, so it is often absent.
    if (data.text !== undefined && data.text !== null) {
      assertValidTextBody(data.text, `${path}.data.text`);
    }
  } else if (e.type === 'table') {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    for (let r = 0; r < rows.length; r++) {
      const cells = (rows[r] as { cells?: unknown })?.cells;
      if (!Array.isArray(cells)) continue;
      for (let c = 0; c < cells.length; c++) {
        const body = (cells[c] as { body?: unknown })?.body;
        if (body === undefined || body === null) continue;
        assertValidTextBody(body, `${path}.data.rows[${r}].cells[${c}].body`);
      }
    }
  } else if (e.type === 'group') {
    const children = Array.isArray(data.children) ? data.children : [];
    for (let i = 0; i < children.length; i++) {
      assertValidElement(children[i], `${path}.data.children[${i}]`);
    }
  }
}

function assertValidTextBody(body: unknown, path: string): void {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException(
      `Invalid element at ${path}: text body must be an object`,
    );
  }
  assertValidTextBodyBlocks(body as Record<string, unknown>, path);
}

/**
 * Validate the block *styles* inside a slide text body.
 *
 * Deliberately narrower than the docs arm's `assertValidBlock`: slide text
 * bodies are persisted verbatim as JSON (there is no attribute codec to
 * normalize them on read), so requiring fields the docs writer dereferences —
 * `id`, `inlines`, a present `style` — would 400 a `GET` → edit → `PUT`
 * round-trip of any deck whose stored blocks predate them. What it does check
 * is every value that would otherwise reach the layout engine unusable: a
 * `style` that is not an object, and the alignment/geometry values inside it.
 */
function assertValidTextBodyBlocks(
  body: Record<string, unknown>,
  path: string,
): void {
  const blocks = body.blocks;
  if (blocks === undefined || blocks === null) return;
  if (!Array.isArray(blocks)) {
    throw new BadRequestException(
      `Invalid element at ${path}: 'blocks' must be an array`,
    );
  }
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] as Record<string, unknown> | null;
    if (!block || typeof block !== 'object') {
      throw new BadRequestException(
        `Invalid block at ${path}.blocks[${i}]: not an object`,
      );
    }
    if (block.style !== undefined && block.style !== null) {
      if (typeof block.style !== 'object') {
        throw new BadRequestException(
          `Invalid block at ${path}.blocks[${i}]: 'style' must be an object`,
        );
      }
      assertValidBlockStyle(
        block.style as Record<string, unknown>,
        `${path}.blocks[${i}]`,
      );
    }
    // A docs table block inside a slide text body holds blocks of its own.
    const rows = (block.tableData as { rows?: unknown } | undefined)?.rows;
    if (!Array.isArray(rows)) continue;
    for (let r = 0; r < rows.length; r++) {
      const cells = (rows[r] as { cells?: unknown })?.cells;
      if (!Array.isArray(cells)) continue;
      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c] as Record<string, unknown> | null;
        if (!cell || typeof cell !== 'object') continue;
        assertValidTextBodyBlocks(
          cell,
          `${path}.blocks[${i}].tableData.rows[${r}].cells[${c}]`,
        );
      }
    }
  }
}
