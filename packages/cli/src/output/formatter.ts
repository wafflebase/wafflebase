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
 * Emit the error envelope on stderr and mark the process as failed.
 *
 * Like `output`, this is not gated by `--quiet`: a non-zero exit with no
 * bytes on either stream tells the caller nothing about what failed or
 * whether it is retryable. Errors go to stderr precisely so they survive
 * output redirection and quiet modes.
 */
export function outputError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({ error: { code: errorCode(error), message } }, null, 2),
  );
  process.exitCode = 1;
}

/**
 * True when `body` is the documented error envelope — an object whose
 * `error` field is an object carrying a string `code`. That `code` is the
 * whole point: it is what agents branch on (see the "Errors" section of
 * `packages/cli/README.md`).
 *
 * Deliberately structural rather than a cast. An Express/Nest 404 or 500
 * body — `{message, error: "Not Found", statusCode}` — has a truthy
 * `error` too, so a truthiness test cannot tell the envelope from the
 * framework's default body.
 */
function isErrorEnvelope(
  body: unknown,
): body is { error: { code: string; message?: string } } {
  const err = (body as { error?: unknown } | null | undefined)?.error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

/**
 * Handle a failed upstream response for the commands that want to pass a
 * backend-shaped error through untouched (e.g. `TYPE_MISMATCH`), so agents
 * reading stderr can act on its `code`.
 *
 * Only a body that *is* the documented envelope is forwarded verbatim.
 * Anything else — a framework 404/500 body where `error` is a string, an
 * HTML page that failed to parse to `null`, a bare string — throws
 * `HTTP <status>`, which the caller's `catch` routes through
 * `outputError` and back into the documented shape. Forwarding those
 * verbatim produced valid JSON with `error.code` and `error.message` both
 * `undefined`, which gives a consumer no signal that the shape is wrong.
 */
export function forwardUpstreamError(res: {
  status: number;
  data: unknown;
}): void {
  if (isErrorEnvelope(res.data)) {
    console.error(JSON.stringify(res.data, null, 2));
    process.exitCode = 1;
    return;
  }
  throw new Error(`HTTP ${res.status}`);
}

/**
 * The stderr body for a failed upstream response on the import/upload/
 * download paths, which report through their own injected `io.stderr` and an
 * exit code instead of throwing into `outputError`.
 *
 * Same rule as `forwardUpstreamError` — only a body that *is* the documented
 * envelope is forwarded verbatim. Anything else becomes the `HTTP_ERROR`
 * envelope those commands' skill files already promise
 * (`packages/cli/skills/docs-import-docx.md`), instead of a framework
 * 404/500 body whose `error.code` reads `undefined`.
 */
export function upstreamErrorJson(res: {
  status: number;
  data?: unknown;
}): string {
  if (isErrorEnvelope(res.data)) return JSON.stringify(res.data, null, 2);
  return JSON.stringify(
    { error: { code: 'HTTP_ERROR', message: `HTTP ${res.status}` } },
    null,
    2,
  );
}
