import { writeFileSync, existsSync } from 'node:fs';
import type { NoteContent } from '../client/http-client.js';

export const VALID_NOTES_CONTENT_FORMATS = ['json', 'md', 'text'] as const;
export type NotesContentFormat = (typeof VALID_NOTES_CONTENT_FORMATS)[number];

export function parseNotesContentFormat(value: string): NotesContentFormat {
  if (!VALID_NOTES_CONTENT_FORMATS.includes(value as NotesContentFormat)) {
    throw new Error(
      `Invalid --format "${value}". Use one of: ${VALID_NOTES_CONTENT_FORMATS.join(', ')}.`,
    );
  }
  return value as NotesContentFormat;
}

/**
 * Surface for `runNotesContent` to talk back to the CLI without taking a
 * direct dependency on `process.stdout` / `process.stderr` / `fs`. Mirrors
 * `SlidesContentIO`; the command wires the real implementations, tests
 * inject in-memory collectors.
 */
export interface NotesContentIO {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
  /** Write `text` to `path`. Throws if the file exists and `force` is false. */
  writeFile: (path: string, text: string, force: boolean) => void;
}

export const defaultNotesContentIO: NotesContentIO = {
  stdout: (text) => {
    process.stdout.write(text);
    if (!text.endsWith('\n')) process.stdout.write('\n');
  },
  stderr: (line) => {
    console.error(line);
  },
  writeFile: (path, text, force) => {
    if (existsSync(path) && !force) {
      throw new Error(
        `Refusing to overwrite "${path}". Pass --force to allow overwrite.`,
      );
    }
    writeFileSync(path, text.endsWith('\n') ? text : text + '\n', 'utf-8');
  },
};

export interface RunNotesContentArgs {
  /** May be null/undefined if the backend returned a 2xx with an empty body. */
  note: NoteContent | null | undefined;
  format: NotesContentFormat;
  out?: string;
  force?: boolean;
  quiet?: boolean;
}

/**
 * Pure orchestration for `notes content`: takes an already-fetched
 * `NoteContent` plus user flags, produces the rendered output, and routes it
 * through the supplied IO surface.
 *
 * A note's content *is* its markdown string, so there is no lossy
 * conversion:
 * - `json`: `{ "content": "…" }` — the raw endpoint shape.
 * - `md` / `text`: the markdown string verbatim.
 */
export function runNotesContent(
  args: RunNotesContentArgs,
  io: NotesContentIO = defaultNotesContentIO,
): void {
  const { note, format, out, force = false, quiet = false } = args;

  // Tolerate a null/empty 2xx body — treat it as an empty note rather than
  // dereferencing null.
  const safeNote: NoteContent = note ?? { content: '' };
  const text =
    format === 'json'
      ? JSON.stringify(safeNote, null, 2)
      : (safeNote.content ?? '');

  if (!out || out === '-') {
    io.stdout(text);
    return;
  }
  io.writeFile(out, text, force);
  if (!quiet) io.stderr(`Wrote to ${out}`);
}
