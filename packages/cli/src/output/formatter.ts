import type { Command } from 'commander';
import { formatJson } from './json.js';
import { formatTable } from './table.js';
import { formatCsv } from './csv.js';
import { formatYaml } from './yaml.js';
import {
  AUTH_FAILED_MESSAGE,
  exitCodeFor,
  exitCodeForStatus,
} from '../errors.js';

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
 *
 * The exit code is the failure's *class*, not a constant (see
 * `../errors.js`): `1` for anything the caller can fix, `2` for
 * network/auth/server faults. Agents branch on `$?` without parsing this
 * body, which is the whole point of the contract.
 */
export function outputError(error: unknown, command?: Command) {
  const message = error instanceof Error ? error.message : String(error);
  const name = command ? commandPath(command) : '';
  console.error(errorEnvelope(errorCode(error), message, name));
  process.exitCode = exitCodeFor(error);
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

/** Longest `code` kept. A code is an identifier agents branch on
 * (`TYPE_MISMATCH`, `SESSION_EXPIRED`); anything longer is not one. */
const MAX_UPSTREAM_CODE = 80;

/**
 * Longest serialized envelope forwarded with its sibling fields intact.
 * Past this the extras are dropped and only `{code, message}` — the two
 * documented fields — survive.
 *
 * The envelope is upstream-controlled content printed into an agent's
 * stderr, so it gets the same treatment as the non-envelope path rather
 * than an unbounded `JSON.stringify(res.data)`: a `command` hint is worth
 * keeping, a stack trace or a megabyte of debug context is not.
 */
const MAX_UPSTREAM_BODY = 4000;

/**
 * The printable form of an upstream text field: a string, or a
 * `class-validator` array of them, capped and with an HTML document
 * rejected outright. `null` when there is nothing worth quoting.
 */
function clampUpstreamText(raw: unknown): string | null {
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
  return clampUpstreamText(
    typeof body === 'string'
      ? body
      : (body as { message?: unknown } | null | undefined)?.message,
  );
}

/**
 * The envelope as it is safe to print: the upstream's own `code` and
 * `message`, both bounded, with its sibling fields (a request id) kept
 * only while the whole body stays small.
 *
 * Forwarding is still verbatim in the sense that matters — the `code`
 * agents branch on is the upstream's — but the bytes it can put on stderr
 * are bounded, and an `error.message` holding an HTML page is dropped for
 * the same reason the non-envelope path drops one.
 *
 * `command` is the one field never forwarded: attribution is the CLI's
 * statement about which command *it* ran (docs/design/cli.md §9), so the
 * upstream's own is dropped and ours written last. A server must not be
 * able to tell an agent that some other call failed.
 */
function safeEnvelope(
  body: { error: { code: string; message?: unknown } },
  status: number,
  command?: string,
): unknown {
  const code = body.error.code.slice(0, MAX_UPSTREAM_CODE);
  const error: Record<string, unknown> = { ...body.error, code };
  if ('message' in body.error) {
    error.message = clampUpstreamText(body.error.message) ?? `HTTP ${status}`;
  }
  delete error.command;
  if (command) error.command = command;
  const whole = { ...body, error };
  return JSON.stringify(whole).length <= MAX_UPSTREAM_BODY
    ? whole
    : {
        error: {
          code,
          message: error.message ?? `HTTP ${status}`,
          ...(command ? { command } : {}),
        },
      };
}

/**
 * `HTTP <status>`, plus the upstream's own wording when it had any.
 *
 * A 401/403 that said nothing useful gets the documented "run login" hint
 * instead of a bare status, so it reads the same here as it does from
 * `httpError()` — the message an agent sees must not depend on which of
 * the two throw sites reported the rejected credential.
 */
function upstreamMessage(res: { status: number; data?: unknown }): string {
  const detail = upstreamDetail(res.data);
  if (detail) return `HTTP ${res.status}: ${detail}`;
  if (res.status === 401 || res.status === 403) return AUTH_FAILED_MESSAGE;
  return `HTTP ${res.status}`;
}

/**
 * The `code` reported for a failed response whose body was *not* the
 * documented envelope, so there is no upstream `code` to forward.
 *
 * Same classification `httpError()` applies at the CLI's other throw
 * sites (`../errors.js`): a rejected credential and a broken server are
 * named as such wherever they surface, so the error matrix in
 * `docs/design/cli.md` holds regardless of which path reported the
 * failure. Everything else is the plain `HTTP_ERROR` the import/upload
 * skill files document.
 */
function upstreamErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'AUTH_ERROR';
  if (status >= 500) return 'SERVER_ERROR';
  return 'HTTP_ERROR';
}

/**
 * A failed upstream response whose body was not the documented envelope.
 *
 * Carries `code` so `outputError` reports the same code that
 * `upstreamErrorJson` writes: the two paths describe the identical
 * condition, so an agent must not have to branch on which command it ran
 * to know what the code will be. `exitCode` comes from the status for the
 * same reason it does everywhere else — a rejected session or a broken
 * server is not something the caller can fix by retyping the command.
 */
export class UpstreamHttpError extends Error {
  readonly code: string;
  readonly exitCode: number;
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UpstreamHttpError';
    this.code = upstreamErrorCode(status);
    this.exitCode = exitCodeForStatus(status);
  }
}

/**
 * Handle a failed upstream response, passing a backend-shaped error through
 * untouched (e.g. `TYPE_MISMATCH`, `SESSION_EXPIRED`) so agents reading
 * stderr can act on its `code`.
 *
 * Every command that talks to the backend routes its `!res.ok` branch
 * through here. It used to be six sites, with the rest throwing
 * `new Error("HTTP <status>")` — which flattened a real envelope (the
 * client's own 401 `SESSION_EXPIRED` most of all) to `{code: "ERROR"}`
 * depending only on which subcommand the agent happened to run. The code an
 * agent branches on must not depend on that.
 *
 * Only a body that *is* the documented envelope is forwarded (through
 * `safeEnvelope`, which bounds what upstream text can reach stderr).
 * Anything else — a framework 404/500 body where `error` is a string, an
 * HTML page that failed to parse to `null`, a bare string — throws an
 * `UpstreamHttpError`, which the caller's `catch` routes through
 * `outputError` and back into the documented shape, keeping the upstream's
 * own `message` text. Forwarding those verbatim produced valid JSON with
 * `error.code` and `error.message` both `undefined`, which gives a consumer
 * no signal that the shape is wrong.
 *
 * `command` is the acting `Command`, exactly as `outputError` takes it —
 * the two are the same emitter seen from either side of a `throw`, so a
 * forwarded envelope and a thrown one must carry the same attribution.
 */
export function forwardUpstreamError(
  res: {
    status: number;
    data: unknown;
  },
  command?: Command,
): void {
  if (isErrorEnvelope(res.data)) {
    console.error(
      JSON.stringify(
        safeEnvelope(
          res.data,
          res.status,
          command ? commandPath(command) : undefined,
        ),
      ),
    );
    // The status still decides the exit class — a 401 `SESSION_EXPIRED`
    // body must not read as a user error just because it is JSON.
    process.exitCode = exitCodeForStatus(res.status);
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
 * input — only a body that *is* the documented envelope is forwarded (with
 * the same `safeEnvelope` bound on its text); anything else becomes the
 * `HTTP_ERROR` envelope those commands'
 * skill files already promise (`packages/cli/skills/docs-import-docx.md`),
 * carrying the upstream's own message rather than a framework 404/500 body
 * whose `error.code` reads `undefined`.
 *
 * `command` is the already-resolved dotted name, not a `Command`: these
 * orchestrators are deliberately free of commander so their tests can drive
 * them directly, and their actions pass `commandPath(this)` in.
 */
export function upstreamErrorJson(
  res: {
    status: number;
    data?: unknown;
  },
  command?: string,
): string {
  if (isErrorEnvelope(res.data))
    return JSON.stringify(safeEnvelope(res.data, res.status, command));
  return errorEnvelope(
    upstreamErrorCode(res.status),
    upstreamMessage(res),
    command,
  );
}
