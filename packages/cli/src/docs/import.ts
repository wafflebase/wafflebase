import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { createInterface } from 'node:readline';
import type { Document, ImageUploader } from '@wafflebase/docs';
import { importDocx } from './docx-import.js';

/**
 * Minimal HTTP surface `runDocsImport` needs from the CLI's
 * `HttpClient`. Spelled out so tests can pass a stub without depending
 * on the full client.
 */
export interface ImportClient {
  createDocument: (
    title: string,
    type?: 'doc' | 'sheet',
  ) => Promise<{ ok: boolean; status: number; data: unknown }>;
  putDocContent: (
    docId: string,
    doc: Document,
  ) => Promise<{ ok: boolean; status: number; data: unknown }>;
}

export interface ImportIO {
  /** Final structured payload — written to stdout as JSON. */
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /**
   * Read the docx bytes for `path`. `'-'` reads from stdin.
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
  /** Whether the current process is interactive (a TTY on stdin).   *  Tests inject `false` to exercise the non-interactive branches. */
  isTTY: boolean;
}

export const defaultImportIO: ImportIO = {
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

export interface RunImportArgs {
  /** Source path. `'-'` reads from stdin. */
  file: string;
  /** Override the doc title. Falls back to the file basename. */
  title?: string;
  /** Existing document ID to overwrite. Pairs with `--yes`. */
  replace?: string;
  /** Skip the interactive `--replace` confirmation. */
  yes?: boolean;
  /** Override the default base64 image uploader. Tests pass a no-op. */
  imageUploader?: ImageUploader;
  /** Suppress informational stderr output (errors still reported). */
  quiet?: boolean;
  /** Print the request that *would* fire instead of issuing it. */
  dryRun?: boolean;
}

export interface RunImportResult {
  /** Process exit code. The action sets `process.exitCode` accordingly. */
  exitCode: number;
}

/**
 * Pure orchestration for `docs import`. Reads the source `.docx`,
 * parses it into a `Document`, then either creates a new document
 * (default) or overwrites an existing one (`--replace`).
 *
 * Why split out from the command action: the action's layered handling
 * of stdin / TTY / interactive prompt is the easiest path to test
 * regressions in. Mocking `process.stdin` at the harness level is
 * fragile; passing in an `ImportIO` lets us drive every branch
 * deterministically.
 */
export async function runDocsImport(
  args: RunImportArgs,
  client: ImportClient,
  io: ImportIO = defaultImportIO,
): Promise<RunImportResult> {
  const { file, replace, yes = false, imageUploader, quiet = false, dryRun = false } = args;

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
                message: `Pass --yes to confirm replacing document "${replace}".`,
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
    const doc = await importDocx(buf, { imageUploader });
    if (dryRun) {
      io.stdout(
        JSON.stringify(
          { method: 'PUT', path: `/documents/${replace}/content`, body: doc },
          null,
          2,
        ),
      );
      return { exitCode: 0 };
    }
    const res = await client.putDocContent(replace, doc);
    if (!res.ok) {
      io.stderr(JSON.stringify(res.data ?? { error: { code: 'HTTP_ERROR' } }, null, 2));
      return { exitCode: 1 };
    }
    io.stdout(JSON.stringify({ id: replace, replaced: true }, null, 2));
    return { exitCode: 0 };
  }

  // Default flow: POST + PUT.
  const buf = await io.readBytes(file);
  const doc = await importDocx(buf, { imageUploader });
  if (dryRun) {
    io.stdout(
      JSON.stringify(
        {
          method: 'POST',
          path: '/documents',
          body: { title: inferredTitle, type: 'doc' },
          followUp: { method: 'PUT', path: '/documents/<new-id>/content' },
        },
        null,
        2,
      ),
    );
    return { exitCode: 0 };
  }

  const created = await client.createDocument(inferredTitle, 'doc');
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

  const put = await client.putDocContent(newId, doc);
  if (!put.ok) {
    io.stderr(JSON.stringify(put.data ?? { error: { code: 'HTTP_ERROR' } }, null, 2));
    return { exitCode: 1 };
  }

  io.stdout(JSON.stringify({ id: newId, title: inferredTitle }, null, 2));
  return { exitCode: 0 };
}

/** Strip the directory and extension to produce a default doc title. */
function defaultTitleFor(file: string): string {
  if (file === '-') return 'Untitled';
  return basename(file, extname(file)) || 'Untitled';
}
