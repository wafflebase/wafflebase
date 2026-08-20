import { formatJson } from './json.js';
import { formatTable } from './table.js';
import { formatCsv } from './csv.js';
import { formatYaml } from './yaml.js';
import { exitCodeFor } from '../errors.js';

export type OutputFormat = 'json' | 'table' | 'csv' | 'yaml';

export const OUTPUT_FORMATS: readonly OutputFormat[] = [
  'json',
  'table',
  'csv',
  'yaml',
];

/**
 * Thrown for an unsupported `--format` value. Carries a structured
 * `code` so `outputError` reports `INVALID_FORMAT` rather than a bare
 * `ERROR`, letting agents tell a bad flag from a failed request.
 *
 * `allowed` defaults to the `output()` vocabulary but is a parameter
 * because `docs`/`slides`/`notes` `content` and `export` reuse the same
 * global `--format` flag for their own vocabularies — they raise this
 * same error so `INVALID_FORMAT` means "bad --format" everywhere.
 */
export class InvalidFormatError extends Error {
  readonly code = 'INVALID_FORMAT';

  constructor(value: string, allowed: readonly string[] = OUTPUT_FORMATS) {
    super(`Invalid --format "${value}". Use one of: ${allowed.join(', ')}.`);
  }
}

/**
 * Narrow a raw `--format` value to an `OutputFormat`, throwing on
 * anything else. Commands that render through `output()` call this
 * before doing any work, so an unsupported format fails loudly instead
 * of being ignored.
 *
 * Validation is per-command, not a `commander` `.choices()` on the
 * global `--format` option: `docs`/`slides`/`notes` `content` and
 * `export` deliberately reuse that same global flag for their own
 * vocabularies (`md`, `text`, `pdf`, `docx`, `pptx`) and validate it
 * themselves.
 */
export function parseOutputFormat(value: string): OutputFormat {
  if (!OUTPUT_FORMATS.includes(value as OutputFormat)) {
    throw new InvalidFormatError(value);
  }
  return value as OutputFormat;
}

export function format(data: unknown, fmt: OutputFormat): string {
  switch (fmt) {
    case 'json':
      return formatJson(data);
    case 'table':
      return formatTable(data);
    case 'csv':
      // The render path: this CSV is opened by a human, so a
      // server-supplied value must not execute as a formula.
      return formatCsv(data, { neutralizeFormulas: true });
    case 'yaml':
      return formatYaml(data);
    default:
      // `fmt` is typed, but it originates from an unvalidated CLI flag;
      // without this branch an unsupported value fell through the
      // switch and printed a bare "undefined".
      throw new InvalidFormatError(String(fmt));
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
 * Emit the error envelope on stderr and mark the process as failed.
 *
 * Like `output`, this is not gated by `--quiet`: a non-zero exit with no
 * bytes on either stream tells the caller nothing about what failed or
 * whether it is retryable. Errors go to stderr precisely so they survive
 * output redirection and quiet modes.
 *
 * The exit code is the failure's *class*, not a constant (see
 * `../errors.js`): `1` for anything the caller can fix, `2` for
 * network/auth/server faults. Agents branch on `$?` without parsing this
 * body, which is the whole point of the contract.
 */
export function outputError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({ error: { code: errorCode(error), message } }, null, 2),
  );
  process.exitCode = exitCodeFor(error);
}
