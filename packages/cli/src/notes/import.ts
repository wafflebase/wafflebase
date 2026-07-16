import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { createInterface } from 'node:readline';
import type { NoteContent } from '../client/http-client.js';

/**
 * Minimal HTTP surface `runNotesImport` needs from the CLI's `HttpClient`.
 * Spelled out so tests can pass a stub without depending on the full client.
 * Mirrors `SlidesImportClient` in `../slides/import.ts`.
 */
export interface NotesImportClient {
  createDocument: (
    title: string,
    type?: 'doc' | 'sheet' | 'slides' | 'note',
  ) => Promise<{ ok: boolean; status: number; data: unknown }>;
  putNoteContent: (
    docId: string,
    note: NoteContent,
  ) => Promise<{ ok: boolean; status: number; data: unknown }>;
}

export interface NotesImportIO {
  /** Final structured payload — written to stdout as JSON. */
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Read the markdown text for `path`. `'-'` reads from stdin. */
  readText: (path: string) => Promise<string>;
  /**
   * Prompt the user for a yes/no answer when running interactively.
   * Returns `true` for affirmative responses (case-insensitive `y` / `yes`);
   * anything else (including end-of-stream) → `false`.
   */
  confirm: (prompt: string) => Promise<boolean>;
  /** Whether the current process is interactive (a TTY on stdin). */
  isTTY: boolean;
}

export const defaultNotesImportIO: NotesImportIO = {
  stdout: (line) => {
    process.stdout.write(line);
    if (!line.endsWith('\n')) process.stdout.write('\n');
  },
  stderr: (line) => {
    console.error(line);
  },
  readText: async (path) => {
    if (path === '-') {
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on('data', (c: Buffer) => chunks.push(c));
        process.stdin.on('end', () =>
          resolve(Buffer.concat(chunks).toString('utf-8')),
        );
        process.stdin.on('error', reject);
      });
    }
    return readFileSync(path, 'utf-8');
  },
  confirm: (prompt) => {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      rl.question(prompt, (answer) => {
        rl.close();
        const a = answer.trim().toLowerCase();
        resolve(a === 'y' || a === 'yes');
      });
    });
  },
  isTTY: process.stdin.isTTY ?? false,
};

export interface RunNotesImportArgs {
  /** Source path. `'-'` reads from stdin. */
  file: string;
  /** Override the note title. Falls back to the file basename. */
  title?: string;
  /** Existing document ID to overwrite. Pairs with `--yes`. */
  replace?: string;
  /** Skip the interactive `--replace` confirmation. */
  yes?: boolean;
  /** Suppress informational stderr output (errors still reported). */
  quiet?: boolean;
  /** Print the request that *would* fire instead of issuing it. */
  dryRun?: boolean;
}

export interface RunNotesImportResult {
  /** Process exit code. The action sets `process.exitCode` accordingly. */
  exitCode: number;
}

/**
 * Pure orchestration for `notes import`. Reads the source markdown, then
 * either creates a new note (default) or overwrites an existing one
 * (`--replace`). A note's content *is* its markdown, so there is no parse
 * step — the file bytes become `{ content }` directly. Mirrors
 * `runSlidesImport` — see that file for the rationale behind the split
 * between this function and the Commander action.
 */
export async function runNotesImport(
  args: RunNotesImportArgs,
  client: NotesImportClient,
  io: NotesImportIO = defaultNotesImportIO,
): Promise<RunNotesImportResult> {
  const { file, replace, yes = false, quiet = false, dryRun = false } = args;

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
                message: `Pass --yes to confirm replacing note "${replace}".`,
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
    const content = await io.readText(file);
    if (dryRun) {
      io.stdout(
        JSON.stringify(
          {
            method: 'PUT',
            path: `/documents/${replace}/content`,
            body: { content },
          },
          null,
          2,
        ),
      );
      return { exitCode: 0 };
    }
    const res = await client.putNoteContent(replace, { content });
    if (!res.ok) {
      io.stderr(
        JSON.stringify(res.data ?? { error: { code: 'HTTP_ERROR' } }, null, 2),
      );
      return { exitCode: 1 };
    }
    io.stdout(JSON.stringify({ id: replace, replaced: true }, null, 2));
    return { exitCode: 0 };
  }

  // Default flow: POST + PUT.
  const content = await io.readText(file);
  if (dryRun) {
    io.stdout(
      JSON.stringify(
        {
          method: 'POST',
          path: '/documents',
          body: { title: inferredTitle, type: 'note' },
          followUp: { method: 'PUT', path: '/documents/<new-id>/content' },
        },
        null,
        2,
      ),
    );
    return { exitCode: 0 };
  }

  const created = await client.createDocument(inferredTitle, 'note');
  if (!created.ok) {
    io.stderr(
      JSON.stringify(created.data ?? { error: { code: 'HTTP_ERROR' } }, null, 2),
    );
    return { exitCode: 1 };
  }
  const newId = (created.data as { id?: string } | null)?.id;
  if (!newId) {
    io.stderr(
      JSON.stringify(
        {
          error: {
            code: 'INVALID_RESPONSE',
            message: 'Server did not return an id',
          },
        },
        null,
        2,
      ),
    );
    return { exitCode: 1 };
  }

  const put = await client.putNoteContent(newId, { content });
  if (!put.ok) {
    io.stderr(
      JSON.stringify(put.data ?? { error: { code: 'HTTP_ERROR' } }, null, 2),
    );
    return { exitCode: 1 };
  }

  io.stdout(JSON.stringify({ id: newId, title: inferredTitle }, null, 2));
  return { exitCode: 0 };
}

function defaultTitleFor(file: string): string {
  if (file === '-') return 'Untitled';
  return basename(file, extname(file)) || 'Untitled';
}
