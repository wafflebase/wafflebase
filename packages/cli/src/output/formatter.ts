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

/** Longest upstream text kept in `message`; enough for a Nest validation
 * list, short enough that an HTML page or a stack trace cannot flood the
 * agent's stderr. */
const MAX_UPSTREAM_MESSAGE = 500;

/**
 * The human-readable part of a non-envelope upstream body, or `null` when
 * there is nothing worth quoting.
 *
 * The backend has no global exception filter, so almost every failure
 * arrives as Nest's default body — `{message, error: "Not Found",
 * statusCode}` — where `message` is the only text that says *what* went
 * wrong ("Document has no file", "Invalid block at blocks[2]: 'id' must be
 * a non-empty string"). `class-validator` makes that field an array of
 * strings. Dropping it and reporting a bare `HTTP 400` leaves the caller
 * with nothing to act on, so it is preserved here.
 */
function upstreamDetail(body: unknown): string | null {
  const raw =
    typeof body === 'string'
      ? body
      : (body as { message?: unknown } | null | undefined)?.message;
  const text = Array.isArray(raw)
    ? raw.filter((part) => typeof part === 'string').join('; ')
    : typeof raw === 'string'
      ? raw
      : '';
  const trimmed = text.trim();
  // An HTML error page (proxy 502, dev-server index) is a document, not a
  // message; quoting its first 500 characters helps nobody.
  if (!trimmed || trimmed.startsWith('<')) return null;
  return trimmed.length > MAX_UPSTREAM_MESSAGE
    ? `${trimmed.slice(0, MAX_UPSTREAM_MESSAGE)}…`
    : trimmed;
}

/** `HTTP <status>`, plus the upstream's own wording when it had any. */
function upstreamMessage(res: { status: number; data?: unknown }): string {
  const detail = upstreamDetail(res.data);
  return detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`;
}

/**
 * A failed upstream response whose body was not the documented envelope.
 *
 * Carries `code` so `outputError` reports the same `HTTP_ERROR` that
 * `upstreamErrorJson` writes: the two paths describe the identical
 * condition, so an agent must not have to branch on which command it ran
 * to know what the code will be.
 */
export class UpstreamHttpError extends Error {
  readonly code = 'HTTP_ERROR';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UpstreamHttpError';
  }
}

/**
 * Handle a failed upstream response for the commands that want to pass a
 * backend-shaped error through untouched (e.g. `TYPE_MISMATCH`), so agents
 * reading stderr can act on its `code`.
 *
 * Only a body that *is* the documented envelope is forwarded verbatim.
 * Anything else — a framework 404/500 body where `error` is a string, an
 * HTML page that failed to parse to `null`, a bare string — throws an
 * `UpstreamHttpError`, which the caller's `catch` routes through
 * `outputError` and back into the documented shape, keeping the upstream's
 * own `message` text. Forwarding those verbatim produced valid JSON with
 * `error.code` and `error.message` both `undefined`, which gives a consumer
 * no signal that the shape is wrong.
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
  throw new UpstreamHttpError(upstreamMessage(res), res.status);
}

/**
 * The stderr body for a failed upstream response on the import/upload/
 * download paths, which report through their own injected `io.stderr` and an
 * exit code instead of throwing into `outputError`.
 *
 * Same rule as `forwardUpstreamError`, and the same output for the same
 * input — only a body that *is* the documented envelope is forwarded
 * verbatim; anything else becomes the `HTTP_ERROR` envelope those commands'
 * skill files already promise (`packages/cli/skills/docs-import-docx.md`),
 * carrying the upstream's own message rather than a framework 404/500 body
 * whose `error.code` reads `undefined`.
 */
export function upstreamErrorJson(res: {
  status: number;
  data?: unknown;
}): string {
  if (isErrorEnvelope(res.data)) return JSON.stringify(res.data, null, 2);
  return JSON.stringify(
    { error: { code: 'HTTP_ERROR', message: upstreamMessage(res) } },
    null,
    2,
  );
}
