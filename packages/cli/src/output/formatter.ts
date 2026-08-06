import { formatJson } from './json.js';
import { formatTable } from './table.js';
import { formatCsv } from './csv.js';
import { exitCodeFor } from '../errors.js';

export type OutputFormat = 'json' | 'table' | 'csv';

export function format(data: unknown, fmt: OutputFormat): string {
  switch (fmt) {
    case 'json':
      return formatJson(data);
    case 'table':
      return formatTable(data);
    case 'csv':
      return formatCsv(data);
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

/**
 * Errors are reported on stderr and classified into the documented exit
 * contract (see `../errors.js`): `1` for anything the caller can fix,
 * `2` for network/auth/server faults. `quiet` suppresses the body but not
 * the classification — scripts branching on `$?` are the main consumer.
 */
export function outputError(error: unknown, quiet: boolean) {
  const exitCode = exitCodeFor(error);
  if (quiet) {
    process.exitCode = exitCode;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({ error: { code: errorCode(error), message } }, null, 2),
  );
  process.exitCode = exitCode;
}
