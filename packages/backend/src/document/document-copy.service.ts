import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Document as DocumentModel } from '@prisma/client';
import { DocumentService } from './document.service';
import { copyTitle, uniqueTitle } from './document-copy-title.util';
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
import { JsonRoot, snapshotJsonRoot } from '../yorkie/yorkie-json';

/**
 * Document types whose Yorkie root holds only plain JSON (no `Tree` / `Text`
 * CRDT), so the copy is a whole-root snapshot assignment and needs no
 * per-type knowledge — a root field added later is copied for free.
 */
const JSON_ROOT_TYPES = new Set(['sheet', 'slides', 'board']);

/**
 * Document types with no CRDT content at all: their bytes are copied by
 * `CopyObject` before `copyContent` runs, so it has nothing left to do. Listed
 * explicitly so a *new* type reaches the throw below instead of silently
 * producing an empty copy reported as success.
 */
const BLOB_TYPES = new Set(['pdf', 'image', 'file']);

/**
 * Where a copy should land, when that is not "beside its source".
 *
 * Supplied only by the template gallery's "use this template"
 * (docs/design/template-gallery.md), which is the one path where a document
 * crosses a workspace boundary. `copy()` itself performs **no** authorization
 * on this — the caller must have asserted membership of `workspaceId` and that
 * `folderId` belongs to it, exactly as the documents controller does for a
 * move. Omitting `dest` entirely preserves "Make a copy" behavior.
 */
export interface CopyDestination {
  workspaceId: string;
  /** `undefined`/`null` = the workspace root, never "the source's folder". */
  folderId?: string | null;
  /** Base title, de-duplicated with `uniqueTitle` instead of `copyTitle`. */
  title?: string;
}

/**
 * Duplicate a document — the server side of "Make a copy"
 * (docs/design/document-copy.md) and of the template gallery's "use this
 * template" (docs/design/template-gallery.md).
 *
 * The copy lands in the source's workspace and folder unless a `dest` says
 * otherwise, owned by whoever asked for it, with fresh timestamps and a fresh
 * Yorkie history. Comments, share links, presence, and analytics are
 * deliberately not carried over: the copy is a new document, and a share link
 * minted for the source must never grant access to it.
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

  async copy(
    source: DocumentModel,
    userId: number,
    dest?: CopyDestination,
  ): Promise<DocumentModel> {
    const workspaceId = dest?.workspaceId ?? source.workspaceId;
    const folderId = dest ? (dest.folderId ?? null) : source.folderId;
    const siblings = await this.documentService.documents({
      where: { workspaceId, folderId },
    });
    // A duplicate is named `<title> (copy)`; a document started from a template
    // is named after the template. See document-copy-title.util.ts.
    const title = dest?.title
      ? uniqueTitle(
          dest.title,
          siblings.map((d) => d.title),
        )
      : copyTitle(
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
        workspace: { connect: { id: workspaceId } },
        ...(folderId ? { folder: { connect: { id: folderId } } } : {}),
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
      const rolledBack = await this.documentService
        .deleteDocument({ id: created.id })
        .then(() => true)
        .catch((cleanupErr) => {
          this.logger.warn(
            `failed to roll back copy ${created.id}: ${cleanupErr}`,
          );
          return false;
        });
      // Only discard the blob once the row that points at it is gone. A
      // surviving row whose blob was deleted is worse than an orphaned blob:
      // the document opens and 404s on its own bytes, and nothing sweeps it.
      if (rolledBack) {
        await this.discardBlob(fileId);
      } else if (fileId) {
        this.logger.warn(
          `keeping blob ${fileId}: its document row ${created.id} survives`,
        );
      }
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

    if (BLOB_TYPES.has(type)) return;

    if (!JSON_ROOT_TYPES.has(type)) {
      // Every branch above is per-type knowledge, so a type nobody taught this
      // service about would copy as an empty document and still report
      // success. Fail loudly instead — the copy is rolled back by the caller.
      throw new BadRequestException(`Cannot copy a ${type} document`);
    }

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
