import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { ImageService } from '../image/image.service';
import {
  collectImageRefs,
  hasWorkspaceImageLink,
  rewriteImageRefs,
  workspaceImageUrl,
} from './document-image-refs';

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
  /**
   * What to do when an image cannot be re-hosted across the workspace
   * boundary. `degrade` (the default) leaves the reference alone and reports
   * it; `fail` aborts the whole copy.
   *
   * The two callers want opposite things, and it turns on who lives with the
   * result. A member using a template asked for *their own* document — one
   * broken image beats no document, and it is theirs to fix. A reviewer
   * approving a template is publishing it to everyone, so an approved listing
   * whose frozen copy has broken first-party images is a defect handed to
   * every future user, none of whom can do anything about it.
   */
  onImageFailure?: 'degrade' | 'fail';
  /**
   * Receives what re-hosting did, once, on success. A callback rather than a
   * return value so `copy()` keeps its `DocumentModel` signature for the
   * callers that do not care, and rather than a field on the service because
   * this one is a singleton serving concurrent requests.
   */
  onImages?: (report: CopyImageReport) => void;
}

/** What a copy did with the source's workspace-scoped images. */
export interface CopyImageReport {
  /** How many references were re-hosted into the destination workspace. */
  rehosted: number;
  /**
   * References left as they were. Each will 403 for the copy's readers — the
   * honest outcome for an image the destination has no right to, and the thing
   * a reviewer must see before approving.
   */
  skipped: Array<{ url: string; reason: string }>;
}

/**
 * How much re-hosting one copy may do.
 *
 * `POST /templates/:id/use` is member-reachable, and "one document's worth of
 * content" stops bounding it once every image is a server-side `CopyObject`.
 * The Miro importer bounds itself the same way; this borrows the shape along
 * with the budget rather than only the shape.
 */
const MAX_REHOSTED_IMAGES = 100;

/**
 * And how many bytes. The object count alone does not bound storage: each
 * image may be up to the upload cap, so 100 of them is gigabytes per request
 * on a route any member can call repeatedly. Mirrors the Miro importer's
 * `MAX_TOTAL_IMAGE_BYTES`.
 */
const MAX_REHOSTED_BYTES = 64 * 1024 * 1024;

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
    private readonly imageService: ImageService,
    private readonly config: ConfigService,
  ) {}

  /**
   * This deployment's own public API origin, or `undefined`.
   *
   * A stored image reference is absolute whenever the frontend was built with
   * an API base (`resolveImageUrl` prepends it), so refusing absolute URLs
   * outright would make re-hosting a no-op in exactly the deployments that
   * need it. But the string comes out of the CRDT, where a collaborator can
   * write `https://attacker.example/api/v1/workspaces/...`, so an absolute URL
   * is trusted only when its origin is ours.
   *
   * Read from `WAFFLEBASE_API_ORIGIN`, falling back to the origin of
   * `GITHUB_CALLBACK_URL` — which the README already defines as "where GitHub
   * redirects the login, and so this server's public scheme", i.e. the same
   * origin. With neither set, only root-relative references are eligible,
   * which is the safe direction.
   */
  private get apiOrigin(): string | undefined {
    const explicit = this.config.get<string>('WAFFLEBASE_API_ORIGIN');
    const source = explicit || this.config.get<string>('GITHUB_CALLBACK_URL');
    if (!source) return undefined;
    try {
      return new URL(source).origin;
    } catch {
      return undefined;
    }
  }

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

    // What re-hosting created, so a later failure can take it back with the
    // rest. `copy()`'s rollback discarded only `fileId` before this existed.
    const rehostedIds: string[] = [];
    try {
      const report = await this.copyContentWithPolicy(
        source.type,
        source.id,
        created.id,
        workspaceId === source.workspaceId
          ? undefined
          : {
              sourceWorkspaceId: source.workspaceId,
              destWorkspaceId: workspaceId,
              onFailure: dest?.onImageFailure ?? 'degrade',
              rehostedIds,
            },
      );
      // A callback rather than a field on the service: this is a singleton, so
      // a `lastReport` property would interleave between concurrent copies and
      // hand one caller another's result.
      if (report) dest?.onImages?.(report);
    } catch (err) {
      // The objects re-hosting created go with the rest of the rollback.
      // Before this existed, a `copyContent` failure after a successful
      // re-host orphaned them with nothing to sweep them.
      await Promise.all(rehostedIds.map((id) => this.discardImage(id)));
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
  private async discardImage(id: string): Promise<void> {
    await this.imageService.delete(id).catch((err) => {
      this.logger.warn(`failed to delete orphaned image ${id}: ${err}`);
    });
  }

  /**
   * Re-host the source's workspace-scoped images into the destination
   * workspace and rewrite the references, returning the rewritten content.
   *
   * Runs only when a copy actually crosses a workspace boundary. Within one
   * workspace the stored URLs keep resolving, so there is nothing to do and
   * nothing to pay for.
   */
  private async rehostImages<T>(
    content: T,
    opts: RehostOptions,
    report: CopyImageReport,
  ): Promise<T> {
    const found = collectImageRefs(
      content,
      opts.sourceWorkspaceId,
      this.apiOrigin,
    );

    // Reported, not dropped. A document whose images all name another
    // workspace would otherwise produce an empty report — indistinguishable
    // from a document with no images at all — and a reviewer would approve a
    // listing whose every image 403s.
    for (const ref of found.foreign) {
      report.skipped.push({
        url: ref.url,
        reason: 'belongs to another workspace',
      });
    }
    if (found.truncated) {
      report.skipped.push({
        url: '(document)',
        reason: 'nested too deeply to scan completely',
      });
    }

    const budgeted = found.rehostable.slice(0, MAX_REHOSTED_IMAGES);
    for (const dropped of found.rehostable.slice(MAX_REHOSTED_IMAGES)) {
      report.skipped.push({
        url: dropped.url,
        reason: `over the ${MAX_REHOSTED_IMAGES}-image limit`,
      });
    }

    const replacements = new Map<string, string>();
    let bytes = 0;
    for (const ref of budgeted) {
      const sourceKey = `${opts.sourceWorkspaceId}/${ref.imageId}`;
      try {
        // `HeadObject` first, because `CopyObject` never brings the bytes into
        // this process and so cannot report what it wrote. Without it the
        // object count is the only bound, and `POST /templates/:id/use` is a
        // member-reachable, repeatable route.
        const size = await this.imageService.size(sourceKey);
        if (bytes + size > MAX_REHOSTED_BYTES) {
          report.skipped.push({
            url: ref.url,
            reason: `over the ${MAX_REHOSTED_BYTES / 1024 / 1024} MB limit`,
          });
          continue;
        }
        const newId = await this.imageService.copy(
          // From `sourceWorkspaceId`, not from `ref.workspaceId`. They are
          // provably equal — `collectImageRefs` put this ref in `rehostable`
          // only because they matched — but reading the trusted value here
          // keeps the invariant local to the S3 call instead of inherited
          // from a filter two functions away.
          sourceKey,
          opts.destWorkspaceId,
        );
        bytes += size;
        opts.rehostedIds.push(`${opts.destWorkspaceId}/${newId}`);
        replacements.set(
          ref.url,
          workspaceImageUrl(opts.destWorkspaceId, newId),
        );
        report.rehosted += 1;
      } catch (err) {
        // One unreadable object must not decide the whole copy on its own —
        // that is what `onFailure` is for, and it is checked once by the
        // caller so a report names every problem rather than only the first.
        this.logger.warn(`failed to re-host ${ref.url}: ${err}`);
        report.skipped.push({ url: ref.url, reason: 'could not be copied' });
      }
    }

    return rewriteImageRefs(content, replacements);
  }

  /**
   * Copy content, then apply the caller's image-failure policy **once**, over
   * the whole report.
   *
   * The check lives here rather than inside `rehostImages` because not every
   * type goes through that function — a note records a skip without ever
   * calling it, and a check buried in the re-hosting loop would let a
   * `fail`-policy promotion succeed on exactly the type it should refuse.
   */
  private async copyContentWithPolicy(
    type: string,
    sourceId: string,
    targetId: string,
    rehost?: RehostOptions,
  ): Promise<CopyImageReport | null> {
    const report = await this.copyContent(type, sourceId, targetId, rehost);
    if (report && report.skipped.length > 0 && rehost?.onFailure === 'fail') {
      throw new BadRequestException(
        `${report.skipped.length} image(s) could not be carried into the destination workspace: ` +
          report.skipped.map((s) => s.reason).join('; '),
      );
    }
    return report;
  }

  private async copyContent(
    type: string,
    sourceId: string,
    targetId: string,
    rehost?: RehostOptions,
  ): Promise<CopyImageReport | null> {
    const report: CopyImageReport = { rehosted: 0, skipped: [] };
    if (type === 'doc') {
      const prefix = yorkieDocKeyPrefix('doc');
      const content = await this.yorkieService.withDocument<
        ReturnType<typeof readDocsRoot>,
        DocsYorkieRoot
      >(sourceId, (doc) => readDocsRoot(doc.getRoot()), {
        docKeyPrefix: prefix,
        syncMode: 'readonly',
      });
      // `doc` images are uploaded to the bucket root (`docsImageUploader` →
      // `POST /images`), so there is normally nothing here to re-host. The
      // pass runs anyway rather than being skipped by type: it costs one walk
      // and finds nothing, whereas skipping it asserts "docs never hold a
      // workspace-scoped URL" — a claim about every past and future writer
      // rather than about this code.
      const rewritten = rehost
        ? await this.rehostImages(content, rehost, report)
        : content;
      await this.yorkieService.withDocument<void, DocsYorkieRoot>(
        targetId,
        (doc) => {
          doc.update((root) => {
            writeDocsRoot(root as DocsYorkieRoot, rewritten);
          });
        },
        { docKeyPrefix: prefix },
      );
      return rehost ? report : null;
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
      // Notes are the one affected type this pass does not fix: the whole
      // content is a single Yorkie `Text`, so rewriting a markdown image link
      // is a CRDT edit rather than a JSON mutation. Reported rather than
      // skipped in silence, so a copy that loses its images says so — but only
      // when there is something to lose, since a report claiming lost images
      // that never existed is its own kind of lie.
      if (rehost && hasWorkspaceImageLink(content)) {
        report.skipped.push({
          url: `note:${sourceId}`,
          reason: 'markdown image links are not re-hosted yet',
        });
      }
      return rehost ? report : null;
    }

    if (BLOB_TYPES.has(type)) return rehost ? report : null;

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
    if (Object.keys(snapshot).length === 0) return rehost ? report : null;
    const stripped = stripComments(snapshot);
    // Re-hosting happens between reading the source and writing the target, on
    // the snapshot rather than on the live document: the source is somebody
    // else's and must not be touched, and the target does not exist yet.
    const content = rehost
      ? await this.rehostImages(stripped, rehost, report)
      : stripped;
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
    return rehost ? report : null;
  }
}

/**
 * What a cross-workspace copy needs in order to re-host images. Absent when
 * the copy stays inside one workspace, where the stored URLs keep resolving.
 */
interface RehostOptions {
  sourceWorkspaceId: string;
  destWorkspaceId: string;
  onFailure: 'degrade' | 'fail';
  /** Filled with `{workspace}/{id}` keys, so a rollback can take them back. */
  rehostedIds: string[];
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
