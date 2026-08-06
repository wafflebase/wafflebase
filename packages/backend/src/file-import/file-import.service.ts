import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
// The engine owns the cell budget: it is the one place both import paths meet,
// so it is the only place the limit can be authoritative. Reading it here
// bounds what crosses the wire rather than what a document may hold — send
// more than the engine will keep and the extra rows are parsed, serialized and
// then discarded. Deliberately not `datasource.service.ts`'s `MAX_ROWS`, which
// governs a read-only path that never materializes anything.
import { MAX_IMPORT_CELLS } from '@wafflebase/sheets';
import {
  extensionOf,
  FileService,
  isDataExtension,
} from '../file/file.service';
import {
  DuckDbService,
  type ImportColumn,
  type ImportFormat,
} from '../lakehouse/duckdb.service';
import { VALID_IMPORT_FILE_ID_PATTERN } from '../file/file.constants';

/**
 * DuckDB error classes caused by the *file*, and therefore the caller's to fix.
 *
 * Deliberately short. The other classes all indicate something on this side is
 * wrong: `IO Error` means the temp file this service just wrote is missing (or
 * an extension failed to load), `Binder Error` means the SQL here is malformed,
 * `Out of Memory Error` means the configured limits are. Telling a user to fix
 * a file that is fine is the worse failure — and the upload queue only backs
 * off on a 429, so a 400 also declares a transient fault permanent.
 */
const FILE_CONTENT_ERRORS = ['Invalid Input Error', 'Conversion Error'];

function isParseFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return FILE_CONTENT_ERRORS.some((prefix) => message.startsWith(prefix));
}

/**
 * Strip absolute paths out of a parser message before it reaches the user.
 *
 * DuckDB names the file it was reading ("CSV Error on Line 12 ... in file
 * /tmp/wafflebase-import-xyz/…"), and this text is surfaced verbatim as the
 * upload row's error. The diagnosis is worth keeping; the server's directory
 * layout is not.
 */
function withoutPaths(message: string, ...paths: string[]): string {
  // Anchored on the paths this service created, not on "anything with a
  // slash": a parser message legitimately contains slashes in the *data* it is
  // complaining about, and a generic rule turns `'2026/01/02'` — the value the
  // user needs to see — into `'2026<file>'`.
  //
  // Callers pass the longest first, so the full file path is replaced whole
  // rather than leaving its basename dangling off a stripped directory.
  return paths.reduce((text, path) => text.split(path).join('<file>'), message);
}

@Injectable()
export class FileImportService {
  private readonly logger = new Logger(FileImportService.name);

  constructor(
    private readonly fileService: FileService,
    private readonly duckdb: DuckDbService,
  ) {}

  /**
   * Parse an uploaded blob and return its first rows.
   *
   * The blob is *not* deleted here. A preview can succeed and the import still
   * fail afterwards (document creation, or the Yorkie write), and the client
   * retries by re-previewing the same `fileId` — deleting on success would
   * break exactly the retry the client persists the id for.
   *
   * Cleanup is a lifecycle rule on the `imports/` prefix instead, which is
   * what the design doc specifies. `FileService` writes data blobs under that
   * prefix precisely so such a rule can target them without touching the
   * pdf/image blobs that documents serve.
   */
  async preview(
    workspaceId: string,
    fileId: string,
  ): Promise<{
    columns: ImportColumn[];
    rows: Record<string, unknown>[];
    rowCount: number;
    truncated: boolean;
    hasHeader: boolean;
  }> {
    if (!VALID_IMPORT_FILE_ID_PATTERN.test(fileId)) {
      throw new BadRequestException('Invalid file id');
    }
    const extension = extensionOf(fileId);
    if (!isDataExtension(extension)) {
      throw new BadRequestException(`Cannot import a .${extension} file.`);
    }
    // Its own format, not an alias: `.tsv` states its delimiter, so the reader
    // is told rather than left to sniff — the client does the same. Sniffing
    // here and stating there is how the same file splits differently either
    // side of the size threshold. Extension text and format name coincide
    // (`IMPORT_EXTENSIONS`/`ImportFormat` share the same literal set), so the
    // checked extension doubles as the format.
    const format = extension as ImportFormat;

    // DuckDB reads a path, not a buffer, so the blob has to land on disk. Its
    // own directory, removed whole in `finally`: a partial write or a crash
    // mid-parse must not leave the upload readable in a shared tmp dir.
    const directory = await mkdtemp(join(tmpdir(), 'wafflebase-import-'));
    const path = join(directory, `${randomUUID()}.${extension}`);
    try {
      // Streamed to disk rather than fetched and then written: a staged blob
      // runs to `MAX_DATA_UPLOAD_BYTES`, and buffering it whole to copy it into
      // this file holds 200 MB twice. (The upload side still buffers — see the
      // note on `MAX_DATA_UPLOAD_BYTES` — so this halves the cost, it does not
      // remove the ceiling.)
      try {
        await pipeline(
          await this.fileService.getObjectStream(fileId, workspaceId),
          createWriteStream(path),
        );
      } catch (error) {
        // Staged blobs expire after `IMPORT_EXPIRY_DAYS`, so a retry the user
        // comes back to a day later finds nothing. Left to propagate this is a
        // 500 carrying a raw SDK message; as a 410 the client knows the id is
        // spent and re-uploads instead of re-previewing it forever.
        if ((error as { name?: string }).name !== 'NoSuchKey') throw error;
        throw new GoneException(
          'This upload has expired. Import the file again.',
        );
      }

      // Schema and table read share one `withReadSlot` hold rather than each
      // acquiring it separately: a gap between them is what let a second
      // request's own schema read — which alone claims the whole read lock —
      // cut in ahead of this request's table read (see `ReadLock`'s comment).
      const { hasHeader, table } = await this.duckdb.withReadSlot(async () => {
        // Schema first: the row budget depends on how wide the table is,
        // and this reads none of them.
        const { columns, hasHeader } = await this.duckdb.readSchema(
          format,
          path,
        );
        // Guarded rather than assumed: `read_csv` reports a placeholder
        // column even for an empty file, but relying on that would make the
        // division below yield `Infinity` the day it stops holding.
        if (columns.length === 0) {
          throw new BadRequestException('This file does not contain any data.');
        }
        // No header reservation: the reader hands a header back as row 0
        // like any other row, so what is counted here is exactly what the
        // engine writes. (It used to subtract one, back when the client
        // prepended `columns` to the table itself — reserving a row for it
        // now would under-count by one.)
        const limit = Math.floor(MAX_IMPORT_CELLS / columns.length);
        // A table this wide cannot be imported at all — one row would
        // already exceed the budget. Clamping the limit to 1 instead would
        // quietly ship twice the budget and still be useless to edit.
        if (limit < 1) {
          throw new BadRequestException(
            `This file has too many columns to import (${columns.length}).`,
          );
        }

        const table = await this.duckdb.readTable(format, path, limit);
        return { columns, hasHeader, table };
      });
      // Guard on rows, not columns, for the reason above. The client parser
      // rejects the same file, and that difference would otherwise be decided
      // by file size.
      if (table.rows.length === 0) {
        throw new BadRequestException('This file does not contain any data.');
      }

      return {
        columns: table.columns,
        rows: table.rows,
        rowCount: table.rows.length,
        truncated: table.truncated,
        hasHeader,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      // Only a parse failure is the *caller's* problem. An engine that cannot
      // start, or a machine out of memory, is ours: reporting those as 400
      // tells the user to fix a file that is fine, and the upload queue only
      // backs off and retries on a 429 — so a transient fault would be
      // presented as permanent.
      if (!isParseFailure(error)) throw error;
      // A malformed file fails inside DuckDB, and its message is the only
      // useful thing anyone has ("CSV Error on Line 12: ..."). It reaches the
      // user as the queue item's error text, so pass it through rather than
      // flattening every failure into "Import failed" — minus the server
      // paths it names.
      const raw = error instanceof Error ? error.message : 'Import failed';
      this.logger.warn(`File import failed for ${fileId}: ${raw}`);
      throw new BadRequestException(withoutPaths(raw, path, directory));
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
}
