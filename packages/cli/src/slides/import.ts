import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { createInterface } from 'node:readline';
import type {
  SlidesDocument,
  UploadImage,
} from '@wafflebase/slides/node';
import {
  importPptx as defaultImportPptx,
  InvalidPptxError,
  type CliPptxImportOptions,
} from './pptx-import.js';
import type { ImportReport } from '@wafflebase/slides/node';

/**
 * Parsing surface — split out so tests can inject a stub that returns
 * a synthetic `SlidesDocument` without building a real `.pptx` byte
 * buffer. Production callers use the default (`importPptx` from
 * `./pptx-import.js`).
 */
export type SlidesImportParser = (
  buf: Uint8Array,
  opts?: CliPptxImportOptions,
) => Promise<{ document: SlidesDocument; report: ImportReport }>;

/**
 * Minimal HTTP surface `runSlidesImport` needs from the CLI's
 * `HttpClient`. Spelled out so tests can pass a stub without depending
 * on the full client. Mirrors `ImportClient` in `../docs/import.ts`.
 */
export interface SlidesImportClient {
  createDocument: (
    title: string,
    type?: 'doc' | 'sheet' | 'slides',
  ) => Promise<{ ok: boolean; status: number; data: unknown }>;
  putSlidesContent: (
    docId: string,
    deck: SlidesDocument,
  ) => Promise<{ ok: boolean; status: number; data: unknown }>;
}

export interface SlidesImportIO {
  /** Final structured payload — written to stdout as JSON. */
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /**
   * Read the pptx bytes for `path`. `'-'` reads from stdin.
   *
   * Split out so tests can inject in-memory buffers without juggling
   * tmp files; the default reads `process.stdin` (or the file
   * synchronously) at the action site.
   */
  readBytes: (path: string) => Promise<Uint8Array>;
  /**
   * Prompt the user for a yes/no answer when running interactively.
   * Returns `true` for affirmative responses (case-insensitive `y` /
   * `yes`); anything else (including end-of-stream) → `false`.
   */
  confirm: (prompt: string) => Promise<boolean>;
  /** Whether the current process is interactive (a TTY on stdin). */
  isTTY: boolean;
}

export const defaultSlidesImportIO: SlidesImportIO = {
  stdout: (line) => {
    process.stdout.write(line);
    if (!line.endsWith('\n')) process.stdout.write('\n');
  },
  stderr: (line) => {
    console.error(line);
  },
  readBytes: async (path) => {
    if (path === '-') {
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on('data', (c: Buffer) => chunks.push(c));
        process.stdin.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
        process.stdin.on('error', reject);
      });
    }
    return new Uint8Array(readFileSync(path));
  },
  confirm: (prompt) => {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      rl.question(prompt, (answer) => {
        rl.close();
        const a = answer.trim().toLowerCase();
        resolve(a === 'y' || a === 'yes');
      });
    });
  },
  isTTY: process.stdin.isTTY ?? false,
};

export interface RunSlidesImportArgs {
  /** Source path. `'-'` reads from stdin. */
  file: string;
  /** Override the deck title. Falls back to the file basename. */
  title?: string;
  /** Existing document ID to overwrite. Pairs with `--yes`. */
  replace?: string;
  /** Skip the interactive `--replace` confirmation. */
  yes?: boolean;
  /** Override the default base64 image uploader. Tests pass a no-op. */
  uploadImage?: UploadImage;
  /** Suppress informational stderr output (errors still reported). */
  quiet?: boolean;
  /** Print the request that *would* fire instead of issuing it. */
  dryRun?: boolean;
  /** Override the .pptx parser — primarily for tests. */
  parser?: SlidesImportParser;
}

export interface RunSlidesImportResult {
  /** Process exit code. The action sets `process.exitCode` accordingly. */
  exitCode: number;
}

/**
 * Pure orchestration for `slides import`. Reads the source `.pptx`,
 * parses it into a `SlidesDocument`, then either creates a new deck
 * (default) or overwrites an existing one (`--replace`). Mirrors
 * `runDocsImport` — see that file for the rationale behind the split
 * between this function and the Commander action.
 */
export async function runSlidesImport(
  args: RunSlidesImportArgs,
  client: SlidesImportClient,
  io: SlidesImportIO = defaultSlidesImportIO,
): Promise<RunSlidesImportResult> {
  const {
    file,
    replace,
    yes = false,
    uploadImage,
    quiet = false,
    dryRun = false,
    parser = defaultImportPptx,
  } = args;

  const inferredTitle = args.title ?? defaultTitleFor(file);

  if (replace) {
    // `--replace` is destructive: confirm interactively unless `--yes`.
    if (!yes) {
      if (!io.isTTY) {
        io.stderr(
          JSON.stringify(
            {
              error: {
                code: 'CONFIRMATION_REQ',
                message: `Pass --yes to confirm replacing deck "${replace}".`,
              },
            },
            null,
            2,
          ),
        );
        return { exitCode: 1 };
      }
      const ok = await io.confirm(
        `This will replace content of ${replace}. Continue? [y/N] `,
      );
      if (!ok) {
        if (!quiet) io.stderr('Aborted.');
        return { exitCode: 0 };
      }
    }
    const buf = await io.readBytes(file);
    const parsed = await safeImportPptx(buf, uploadImage, io, parser);
    if (parsed === null) return { exitCode: 1 };
    const { document: deck, report } = parsed;
    if (dryRun) {
      io.stdout(
        JSON.stringify(
          {
            method: 'PUT',
            path: `/documents/${replace}/content`,
            body: deck,
            report: summariseReport(report),
          },
          null,
          2,
        ),
      );
      return { exitCode: 0 };
    }
    const res = await client.putSlidesContent(replace, deck);
    if (!res.ok) {
      io.stderr(JSON.stringify(res.data ?? { error: { code: 'HTTP_ERROR' } }, null, 2));
      return { exitCode: 1 };
    }
    io.stdout(
      JSON.stringify(
        { id: replace, replaced: true, report: summariseReport(report) },
        null,
        2,
      ),
    );
    return { exitCode: 0 };
  }

  // Default flow: POST + PUT.
  const buf = await io.readBytes(file);
  const parsedNew = await safeImportPptx(buf, uploadImage, io, parser);
  if (parsedNew === null) return { exitCode: 1 };
  const { document: deck, report } = parsedNew;
  if (dryRun) {
    io.stdout(
      JSON.stringify(
        {
          method: 'POST',
          path: '/documents',
          body: { title: inferredTitle, type: 'slides' },
          followUp: { method: 'PUT', path: '/documents/<new-id>/content' },
          report: summariseReport(report),
        },
        null,
        2,
      ),
    );
    return { exitCode: 0 };
  }

  const created = await client.createDocument(inferredTitle, 'slides');
  if (!created.ok) {
    io.stderr(JSON.stringify(created.data ?? { error: { code: 'HTTP_ERROR' } }, null, 2));
    return { exitCode: 1 };
  }
  const newId = (created.data as { id?: string } | null)?.id;
  if (!newId) {
    io.stderr(
      JSON.stringify(
        { error: { code: 'INVALID_RESPONSE', message: 'Server did not return an id' } },
        null,
        2,
      ),
    );
    return { exitCode: 1 };
  }

  const put = await client.putSlidesContent(newId, deck);
  if (!put.ok) {
    io.stderr(JSON.stringify(put.data ?? { error: { code: 'HTTP_ERROR' } }, null, 2));
    return { exitCode: 1 };
  }

  io.stdout(
    JSON.stringify(
      { id: newId, title: inferredTitle, report: summariseReport(report) },
      null,
      2,
    ),
  );
  return { exitCode: 0 };
}

function defaultTitleFor(file: string): string {
  if (file === '-') return 'Untitled';
  return basename(file, extname(file)) || 'Untitled';
}

/**
 * Collect the parser's `ImportReport` counters into a plain object so
 * the CLI can print them as JSON. We surface every counter rather than
 * the `.summary()` string so agentic callers can parse without
 * regex-matching prose.
 */
function summariseReport(report: ImportReport): Record<string, number> {
  return {
    groupsFlattened: report.groupsFlattened,
    tablesFlattened: report.tablesFlattened,
    shadowsDropped: report.shadowsDropped,
    textBoxesPreScaled: report.textBoxesPreScaled,
    unknownShapes: report.unknownShapes,
    unknownLayoutTypes: report.unknownLayoutTypes,
    tableMergesIgnored: report.tableMergesIgnored,
    tableBordersApproximated: report.tableBordersApproximated,
    skippedImages: report.skippedImages,
  };
}

/**
 * Run `importPptx` and turn `InvalidPptxError` into a structured stderr
 * body + `null` return so callers can short-circuit with `exitCode: 1`
 * while keeping the rest of the error envelope (`HTTP_ERROR`,
 * `INVALID_RESPONSE`, etc.) consistent.
 */
async function safeImportPptx(
  buf: Uint8Array,
  uploadImage: UploadImage | undefined,
  io: SlidesImportIO,
  parser: SlidesImportParser,
): Promise<{ document: SlidesDocument; report: ImportReport } | null> {
  try {
    return await parser(buf, { uploadImage });
  } catch (e) {
    if (e instanceof InvalidPptxError) {
      io.stderr(
        JSON.stringify(
          { error: { code: e.code, message: e.message } },
          null,
          2,
        ),
      );
      return null;
    }
    throw e;
  }
}
