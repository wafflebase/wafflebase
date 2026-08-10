import { formatJson } from './json.js';
import { formatTable } from './table.js';
import { formatCsv } from './csv.js';

export type OutputFormat = 'json' | 'table' | 'csv';

export const OUTPUT_FORMATS: readonly OutputFormat[] = ['json', 'table', 'csv'];

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
      return formatCsv(data);
    default:
      // `fmt` is typed, but it originates from an unvalidated CLI flag;
      // without this branch an unsupported value fell through the
      // switch and printed a bare "undefined".
      throw new InvalidFormatError(String(fmt));
  }
}

export function output(data: unknown, fmt: OutputFormat, quiet: boolean) {
  if (quiet) return;
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

export function outputError(error: unknown, quiet: boolean) {
  if (quiet) {
    process.exitCode = 1;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({ error: { code: errorCode(error), message } }, null, 2),
  );
  process.exitCode = 1;
}
