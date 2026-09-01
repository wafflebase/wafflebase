import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { seg } from '../client/url.js';
import type {
  AxisMove,
  AxisShift,
  WorksheetAxis,
} from '../client/http-client.js';

/**
 * Structural edits on a spreadsheet tab: clearing a range, and inserting,
 * deleting or moving rows and columns.
 *
 * Every verb here is a POST whose body *is* the request — the four endpoints
 * (`clear` / `insert` / `delete` / `move`) take a small JSON object and echo it
 * back — so each command reads that object from `--data` or stdin exactly as
 * `sheets cells batch` does, rather than spelling the same fields out as flags
 * that would then have to be kept in step with the server's parser.
 *
 * The backend applies the same engine helpers the editor does, so formulas,
 * merges, styles, validations, chart ranges and comment anchors follow the
 * edit. Two documented differences are worth repeating in `--help`, because
 * both are visible to a caller: cached formula values are **cleared, not
 * recalculated** (a subsequent `cells get` reports `value: null` for formula
 * cells until an editor session recalculates), and a move that would split a
 * merged range is refused with `409` rather than silently no-oped.
 */
export function registerSheetsStructureCommand(parent: Command) {
  parent
    .command('clear <doc-id>')
    .description(
      'Empty a cell range, keeping rows and columns (JSON from stdin or --data)',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Request body as JSON: { "range": "A1:C10" }')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      const raw = await readJsonBody(this, dataStr, 'clear data');
      if (raw === NoBody) return;

      let body: { range: string };
      try {
        body = toClearBody(raw);
      } catch (e) {
        outputError(e, this);
        return;
      }

      try {
        // Inside the try, ahead of `--format` validation: the preview is
        // built from ids, and `seg()` refuses a `.` / `..` one. That refusal
        // has to reach `outputError` as the error envelope rather than
        // escape the handler as a rejected action promise.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'POST',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/clear`,
            body,
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).clearRange(docId, tab, body.range);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  parent
    .command('insert <doc-id>')
    .description(
      'Insert rows or columns (JSON from stdin or --data: { "axis": "row", "index": 2, "count": 3 })',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Request body as JSON: { axis, index, count }')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      const raw = await readJsonBody(this, dataStr, 'insert data');
      if (raw === NoBody) return;

      let shift: AxisShift;
      try {
        shift = toAxisShift(raw);
      } catch (e) {
        outputError(e, this);
        return;
      }

      try {
        // See `clear` above: the preview interpolates ids, so it sits inside
        // the try and ahead of `--format` validation.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'POST',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/insert`,
            shift,
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).insertAxis(docId, tab, shift);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  parent
    .command('delete <doc-id>')
    .description(
      'Delete rows or columns (JSON from stdin or --data: { "axis": "row", "index": 2, "count": 3 })',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Request body as JSON: { axis, index, count }')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      const raw = await readJsonBody(this, dataStr, 'delete data');
      if (raw === NoBody) return;

      let shift: AxisShift;
      try {
        // `count` is positive on the wire for a delete too. The engine's
        // negative-count convention is applied server-side, and the response
        // echoes the positive count back.
        shift = toAxisShift(raw);
      } catch (e) {
        outputError(e, this);
        return;
      }

      try {
        // See `clear` above: the preview interpolates ids, so it sits inside
        // the try and ahead of `--format` validation.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'POST',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/delete`,
            shift,
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).deleteAxis(docId, tab, shift);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  parent
    .command('move <doc-id>')
    .description(
      'Move rows or columns (JSON from stdin or --data: { "axis": "row", "srcIndex": 2, "count": 1, "dstIndex": 5 }); 409 if the move would split a merged range',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option(
      '--data <json>',
      'Request body as JSON: { axis, srcIndex, count, dstIndex }',
    )
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      const raw = await readJsonBody(this, dataStr, 'move data');
      if (raw === NoBody) return;

      let move: AxisMove;
      try {
        move = toAxisMove(raw);
      } catch (e) {
        outputError(e, this);
        return;
      }

      try {
        // See `clear` above: the preview interpolates ids, so it sits inside
        // the try and ahead of `--format` validation.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'POST',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/move`,
            move,
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).moveAxis(docId, tab, move);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}

/**
 * Sentinel for "the payload was rejected and the envelope is already on
 * stderr". `undefined` cannot be confused with a parsed body — `JSON.parse`
 * never yields it — but a unique symbol says so at the type level too, so a
 * caller that forgets the guard fails to compile rather than posting
 * `undefined`.
 */
const NoBody = Symbol('no-body');

/**
 * Read the request body from `--data` or stdin, mirroring `sheets cells batch`.
 *
 * A malformed payload is user input, and the message has to name which one it
 * came from: `runCli` would envelope an uncaught `SyntaxError` anyway, but as a
 * bare "Unexpected token …" with no mention of `--data` or stdin. Returns
 * {@link NoBody} once the envelope has been written, so the caller returns
 * without a second error.
 */
async function readJsonBody(
  command: Command,
  dataStr: string | undefined,
  what: string,
): Promise<unknown> {
  try {
    let raw: string;
    if (dataStr) {
      raw = dataStr;
    } else {
      // Read from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      raw = Buffer.concat(chunks).toString('utf-8');
    }
    return JSON.parse(raw) as unknown;
  } catch (e) {
    outputError(
      new Error(
        `Invalid JSON ${what}${dataStr ? ' in --data' : ' on stdin'}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ),
      command,
    );
    return NoBody;
  }
}

/**
 * Where the client-side validation line is drawn.
 *
 * The *shape* of the body is this command's own contract — which fields exist,
 * that `axis` is one of two words, that indices are 1-based whole numbers — and
 * it is checked here for the reason `tabs create` checks `--type` before its
 * dry-run branch: a `--dry-run` that prints a body the server would reject is
 * worse than no dry run at all.
 *
 * The *limits* are deliberately not checked here. The grid bounds and
 * `MaxAxisEntries` are server policy, and the entries a request materializes
 * depend on how long the axis already is — something only the backend can see,
 * inside its own `doc.update`. Restating those numbers would give the CLI a
 * copy that drifts, so they are left to the 400 the server already returns.
 */
function asObject(body: unknown, shape: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(`Request body must be a JSON object ${shape}`);
  }
  return body as Record<string, unknown>;
}

function pickAxis(raw: unknown): WorksheetAxis {
  if (raw !== 'row' && raw !== 'column') {
    throw new Error(`'axis' must be "row" or "column"`);
  }
  return raw;
}

/** A 1-based index or a count: a whole number, never zero and never negative. */
function pickPositiveInt(raw: unknown, field: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new Error(
      `'${field}' must be a positive integer (indices are 1-based); got ${JSON.stringify(
        raw,
      )}`,
    );
  }
  return raw;
}

function toClearBody(body: unknown): { range: string } {
  const b = asObject(body, '{ range }');
  const range = b.range;
  if (typeof range !== 'string' || range.length === 0) {
    throw new Error(`'range' must be a non-empty A1 range string, e.g. A1:C10`);
  }
  // Rebuilt rather than forwarded: the client sends exactly this object, so
  // the `--dry-run` preview stays the request that would be sent even when the
  // caller's JSON carries extra keys.
  return { range };
}

function toAxisShift(body: unknown): AxisShift {
  const b = asObject(body, '{ axis, index, count }');
  const axis = pickAxis(b.axis);
  return {
    axis,
    index: pickPositiveInt(b.index, 'index'),
    count: pickPositiveInt(b.count, 'count'),
  };
}

function toAxisMove(body: unknown): AxisMove {
  const b = asObject(body, '{ axis, srcIndex, count, dstIndex }');
  const axis = pickAxis(b.axis);
  return {
    axis,
    srcIndex: pickPositiveInt(b.srcIndex, 'srcIndex'),
    count: pickPositiveInt(b.count, 'count'),
    dstIndex: pickPositiveInt(b.dstIndex, 'dstIndex'),
  };
}
