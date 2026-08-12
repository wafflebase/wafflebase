import type { Command } from 'commander';
import { formatJson } from './json.js';
import { formatTable } from './table.js';
import { formatCsv } from './csv.js';
import { formatYaml } from './yaml.js';

export type OutputFormat = 'json' | 'table' | 'csv' | 'yaml';

export function format(data: unknown, fmt: OutputFormat): string {
  switch (fmt) {
    case 'json':
      return formatJson(data);
    case 'table':
      return formatTable(data);
    case 'csv':
      return formatCsv(data);
    case 'yaml':
      return formatYaml(data);
    default:
      throw new Error(`Unsupported output format: ${String(fmt)}`);
  }
}

/**
 * Emit a command's result body on stdout.
 *
 * `--quiet` deliberately does not reach this function. It gates progress
 * notices only (docs/design/cli.md §9); the body is the data callers
 * redirect, so suppressing it made `... --quiet > out.json` write an
 * empty file.
 */
export function output(data: unknown, fmt: OutputFormat) {
  console.log(format(data, fmt));
}

/**
 * Preserve a structured `code` from any thrown `Error` subclass that
 * carries one (e.g., `InvalidDocxError`'s `code = 'INVALID_DOCX'`).
 * Skill files document those codes, so silently flattening every
 * failure to `'ERROR'` made agents unable to branch on the cause.
 */
function errorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'ERROR';
}

/**
 * Dotted name of a command, e.g. `docs.content` or `sheets.cells.get`.
 *
 * The chain stops below the root program (`wafflebase`), so the result is
 * the same string the `schema` command indexes on. Aliases collapse for
 * free: commander's `name()` returns the canonical name, so
 * `wafflebase doc content` still reports `docs.content`.
 */
export function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let c: Command | null = cmd; c.parent; c = c.parent) {
    names.unshift(c.name());
  }
  return names.join('.');
}

/**
 * Render the error envelope as the single line that goes on stderr.
 *
 * Exported because `outputError` is not the only emitter: the import /
 * upload / download orchestrators own their own IO seam and exit code, and
 * `schema` reports an unknown command without throwing. They all have to
 * produce the same one-line, `command`-attributed shape (docs/design/cli.md
 * §9), so the shape is defined once here rather than hand-rolled per file.
 */
export function errorEnvelope(
  code: string,
  message: string,
  command?: string,
): string {
  return JSON.stringify({
    error: { code, message, ...(command ? { command } : {}) },
  });
}

/**
 * The same envelope, built from a backend error body.
 *
 * The upstream `error` object's own fields are preserved — agents branch on
 * `code`, and endpoints attach extra context alongside it — but never its
 * `command`: attribution is the CLI's statement about which command *it*
 * ran, so a server cannot forge it. Anything that is not a backend-shaped
 * `{ error: { … } }` body falls back to the caller's code/message.
 */
export function backendErrorEnvelope(
  data: unknown,
  fallback: { code: string; message: string },
  command?: string,
): string {
  const raw = (data as { error?: unknown } | null | undefined)?.error;
  const fields: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  delete fields.command;
  const code =
    typeof fields.code === 'string' && fields.code ? fields.code : fallback.code;
  const message =
    typeof fields.message === 'string' && fields.message
      ? fields.message
      : fallback.message;
  return JSON.stringify({
    error: { ...fields, code, message, ...(command ? { command } : {}) },
  });
}

/**
 * Emit the error envelope on stderr and mark the process as failed.
 *
 * A single line, not pretty-printed JSON (docs/design/cli.md §9): one line
 * per error is what lets a caller read stderr with a line-delimited parser
 * and tell two errors apart. `command` carries the dotted command name so an
 * agent driving several calls can attribute the failure; it is omitted rather
 * than guessed when no command is known.
 *
 * Like `output`, this is not gated by `--quiet`: a non-zero exit with no
 * bytes on either stream tells the caller nothing about what failed or
 * whether it is retryable. Errors go to stderr precisely so they survive
 * output redirection and quiet modes.
 */
export function outputError(error: unknown, command?: Command) {
  const message = error instanceof Error ? error.message : String(error);
  const name = command ? commandPath(command) : '';
  console.error(errorEnvelope(errorCode(error), message, name));
  process.exitCode = 1;
}
