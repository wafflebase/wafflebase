import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Document as DocumentModel } from '@prisma/client';
import { DocumentService } from './document.service';
import { copyTitle } from './document-copy-title.util';
import { FileService } from '../file/file.service';
import { VALID_FILE_ID_PATTERN } from '../file/file.constants';
import { YorkieService } from '../yorkie/yorkie.service';
import { yorkieDocKeyPrefix } from '../yorkie/yorkie-doc-key';
import {
  DocsYorkieRoot,
  readDocsRoot,
  writeDocsRoot,
} from '../yorkie/docs-tree';
import {
  NoteYorkieRoot,
  readNoteRoot,
  writeNoteRoot,
} from '../yorkie/note-content';

/** A Yorkie root made of plain JSON — copyable as a whole-root snapshot. */
type JsonRoot = Record<string, unknown>;

/**
 * Document types whose Yorkie root holds only plain JSON (no `Tree` / `Text`
 * CRDT), so the copy is a whole-root snapshot assignment and needs no
 * per-type knowledge — a root field added later is copied for free.
 */
const JSON_ROOT_TYPES = new Set(['sheet', 'slides', 'board']);

/**
 * Duplicate a document — the server side of "Make a copy"
 * (docs/design/document-copy.md).
 *
 * The copy lands in the source's workspace and folder, owned by whoever asked
 * for it, with fresh timestamps and a fresh Yorkie history. Comments, share
 * links, presence, and analytics are deliberately not carried over: the copy is
 * a new document, and a share link minted for the source must never grant
 * access to it.
 *
 * Content is copied per type. Both blob and CRDT paths produce an *independent*
 * copy — deleting the source (which deletes its blob) cannot affect it.
 */
@Injectable()
export class DocumentCopyService {
  private readonly logger = new Logger(DocumentCopyService.name);

  constructor(
    private readonly documentService: DocumentService,
    private readonly fileService: FileService,
    private readonly yorkieService: YorkieService,
  ) {}

  async copy(source: DocumentModel, userId: number): Promise<DocumentModel> {
    const siblings = await this.documentService.documents({
      where: { workspaceId: source.workspaceId, folderId: source.folderId },
    });
    const title = copyTitle(
      source.title,
      siblings.map((d) => d.title),
    );

    // Order matters: everything that can fail without leaving a trace runs
    // first, and each later step rolls back what the earlier ones created.
    //
    // The stored id is re-validated before it reaches S3, exactly as every
    // other blob path does (document-file.controller.ts, api/v1/files.controller.ts,
    // document.controller.ts). `CopyObject` is a storage *sink* keyed by this
    // value, so a row whose `fileId` was ever written to something other than
    // a `<uuid>[.ext]` blob id must not be laundered into a fresh, servable id.
    if (source.fileId && !VALID_FILE_ID_PATTERN.test(source.fileId)) {
      throw new BadRequestException('Document has an invalid file reference');
    }
    const fileId = source.fileId
      ? await this.fileService.copy(source.fileId)
      : undefined;

    let created: DocumentModel;
    try {
      created = await this.documentService.createDocument({
        title,
        type: source.type,
        ...(fileId
          ? {
              fileId,
              // The copied bytes are the source's bytes, so its blob metadata
              // describes them exactly.
              fileSize: source.fileSize,
              mimeType: source.mimeType,
            }
          : {}),
        author: { connect: { id: userId } },
        workspace: { connect: { id: source.workspaceId } },
        ...(source.folderId
          ? { folder: { connect: { id: source.folderId } } }
          : {}),
      });
    } catch (err) {
      await this.discardBlob(fileId);
      throw err;
    }

    try {
      await this.copyContent(source.type, source.id, created.id);
    } catch (err) {
      // Unlike the import queue — which leaves an empty document behind for a
      // retry to fill — a failed copy rolls back. "Make a copy" has no retry
      // affordance, so an empty document claiming to be a copy would read as
      // success and silently lose the content.
      await this.documentService
        .deleteDocument({ id: created.id })
        .catch((cleanupErr) => {
          this.logger.warn(
            `failed to roll back copy ${created.id}: ${cleanupErr}`,
          );
        });
      await this.discardBlob(fileId);
      throw err;
    }

    return created;
  }

  private async discardBlob(fileId: string | undefined): Promise<void> {
    if (!fileId) return;
    await this.fileService.delete(fileId).catch((err) => {
      this.logger.warn(`failed to delete orphaned blob ${fileId}: ${err}`);
    });
  }

  /**
   * Copy the Yorkie content of `sourceId` onto the brand-new document
   * `targetId`. Blob-backed types (`pdf` / `image` / `file`) have no CRDT
   * content — their bytes were already copied — so they are a no-op here.
   *
   * The writers below are documented last-write-wins primitives, which is safe
   * precisely because the target key has never been attached to by anyone: a
   * document nobody has opened has no concurrent edit to lose.
   */
  private async copyContent(
    type: string,
    sourceId: string,
    targetId: string,
  ): Promise<void> {
    if (type === 'doc') {
      const prefix = yorkieDocKeyPrefix('doc');
      const content = await this.yorkieService.withDocument<
        ReturnType<typeof readDocsRoot>,
        DocsYorkieRoot
      >(sourceId, (doc) => readDocsRoot(doc.getRoot()), {
        docKeyPrefix: prefix,
        syncMode: 'readonly',
      });
      await this.yorkieService.withDocument<void, DocsYorkieRoot>(
        targetId,
        (doc) => {
          doc.update((root) => {
            writeDocsRoot(root as DocsYorkieRoot, content);
          });
        },
        { docKeyPrefix: prefix },
      );
      return;
    }

    if (type === 'note') {
      const prefix = yorkieDocKeyPrefix('note');
      const content = await this.yorkieService.withDocument<
        ReturnType<typeof readNoteRoot>,
        NoteYorkieRoot
      >(sourceId, (doc) => readNoteRoot(doc.getRoot()), {
        docKeyPrefix: prefix,
        syncMode: 'readonly',
      });
      await this.yorkieService.withDocument<void, NoteYorkieRoot>(
        targetId,
        (doc) => {
          doc.update((root) => {
            writeNoteRoot(root as NoteYorkieRoot, content);
          });
        },
        { docKeyPrefix: prefix },
      );
      return;
    }

    if (!JSON_ROOT_TYPES.has(type)) return;

    const prefix = yorkieDocKeyPrefix(type);
    const snapshot = await this.yorkieService.withDocument<JsonRoot, JsonRoot>(
      sourceId,
      (doc) => snapshotJsonRoot(doc),
      { docKeyPrefix: prefix, syncMode: 'readonly' },
    );
    // A document nobody has opened yet has an empty root; there is nothing to
    // write, and the copy's editor seeds it on first open exactly as it would
    // for a brand-new document.
    if (Object.keys(snapshot).length === 0) return;
    const content = stripComments(snapshot);
    await this.yorkieService.withDocument<void, JsonRoot>(
      targetId,
      (doc) => {
        doc.update((root) => {
          for (const [key, value] of Object.entries(content)) {
            (root as JsonRoot)[key] = reviveLongs(value);
          }
        });
      },
      { docKeyPrefix: prefix },
    );
  }
}

/**
 * Drop comment threads from a whole-root snapshot. The copy is a new document,
 * so it carries no comments (docs/design/document-copy.md) — the `doc` arm gets
 * this for free because `readDocsRoot` never reads them, but the JSON arm
 * copies every root key verbatim and spreadsheet threads live *inside* the root
 * at `sheets[tabId].comments` (`Worksheet.comments` in
 * packages/sheets/src/model/workbook/worksheet-document.ts).
 *
 * The map is emptied rather than deleted: `createWorksheet` seeds `comments: {}`
 * deliberately so concurrent first comments merge instead of one LWW-clobbering
 * the other, and a copy must start with that same shared container.
 */
export function stripComments(snapshot: JsonRoot): JsonRoot {
  const out: JsonRoot = { ...snapshot };
  if (isPlainObject(out.comments)) out.comments = {};
  if (!isPlainObject(out.sheets)) return out;
  const sheets: JsonRoot = {};
  for (const [tabId, worksheet] of Object.entries(out.sheets)) {
    sheets[tabId] =
      isPlainObject(worksheet) && isPlainObject(worksheet.comments)
        ? { ...worksheet, comments: {} }
        : worksheet;
  }
  out.sheets = sheets;
  return out;
}

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/**
 * Re-coerce out-of-32-bit-range integers to `bigint` before they are written
 * back into a Yorkie root.
 *
 * Yorkie 0.7.x classifies every integer-valued JS number as a 32-bit Integer,
 * so a value the source stored as a Long — any epoch-millisecond timestamp —
 * would be truncated to its low 32 bits when the snapshot (plain JSON numbers,
 * straight out of `JSON.parse`) is assigned onto the copy. This is the same
 * boundary conversion the frontend does when writing timestamps
 * (`toYorkieMs` in packages/frontend/src/app/spreadsheet/yorkie-worksheet-comments.ts).
 */
export function reviveLongs(value: unknown): unknown {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (value > INT32_MAX || value < INT32_MIN)
  ) {
    return BigInt(value) as unknown as number;
  }
  if (Array.isArray(value)) return value.map(reviveLongs);
  if (isPlainObject(value)) {
    const out: JsonRoot = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = reviveLongs(child);
    }
    return out;
  }
  return value;
}

function isPlainObject(value: unknown): value is JsonRoot {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The whole Yorkie root as detached plain JSON. `Document.toJSON()` yields the
 * root as a JSON *string* (the proxy's `toJSON` is what makes
 * `JSON.stringify(root)` double-encode), so nested string layers are unwrapped
 * — same handling as `scripts/copy-yorkie-documents.ts`, which copies
 * spreadsheet roots between Yorkie servers this way.
 *
 * That script also needs a fallback, and so does this: some documents contain
 * control characters that Yorkie's raw JSON string path does not escape
 * correctly, so `JSON.parse(doc.toJSON())` throws on them. `JSON.stringify`
 * over the root proxy still produces a valid detached snapshot, so a copy of an
 * affected document succeeds instead of failing outright.
 */
export function snapshotJsonRoot(doc: {
  toJSON: () => string;
  getRoot?: () => unknown;
}): Record<string, unknown> {
  try {
    return asJsonRoot(JSON.parse(doc.toJSON()));
  } catch (err) {
    if (typeof doc.getRoot !== 'function') throw err;
    return asJsonRoot(JSON.parse(JSON.stringify(doc.getRoot())));
  }
}

/** Unwrap nested JSON string layers and assert the result is an object. */
function asJsonRoot(parsed: unknown): Record<string, unknown> {
  let value = parsed;
  while (typeof value === 'string') {
    value = JSON.parse(value);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Yorkie document root snapshot is not an object');
  }
  return value as Record<string, unknown>;
}
