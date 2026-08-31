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
import { unwrap } from './payload.js';
import type {
  PivotTableDefinition,
  WorksheetFilterState,
} from '../client/http-client.js';

/**
 * Worksheet analysis state — the tab's filter and its pivot table.
 *
 * Both are a single worksheet-level object rather than a collection, so each
 * verb pair is a plain GET / PUT: the PUT replaces the whole object, and an
 * explicit `null` clears it. The server refuses an *omitted* key rather than
 * treating it as a clear (see `parseFilter` / `parsePivot` in the backend), so
 * the payload here is always required — there is no "set nothing" spelling.
 */

/** The parsed JSON payload, or the message explaining why it is not one. */
type PayloadResult =
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; message: string };

/**
 * Read the write payload from `--data` or stdin.
 *
 * Parsed in one place for both resources because the failure message is the
 * load-bearing part: `runCli` would envelope an uncaught `SyntaxError` anyway,
 * but as a bare "Unexpected token …" with no mention of `--data` or stdin, and
 * naming the source is the whole reason this is caught here. Mirrors
 * `cells batch`, down to the message shape.
 *
 * The structural check is the server's own rule for these two bodies: the
 * value is an object, or `null` to clear. Anything else — an array, a bare
 * string, a number — is a 400 upstream, so it is rejected locally *before* the
 * dry-run branch: a preview that prints a request the server would reject is
 * worse than no preview at all.
 */
async function readPayload(
  dataStr: string | undefined,
  label: string,
): Promise<PayloadResult> {
  let parsed: unknown;
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
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      message: `Invalid JSON ${label} data${
        dataStr ? ' in --data' : ' on stdin'
      }: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (parsed === null) return { ok: true, value: null };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      message:
        `Invalid ${label} payload: expected a JSON object, or null to clear ` +
        `the ${label}; got ${Array.isArray(parsed) ? 'an array' : `a ${typeof parsed}`}.`,
    };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

export function registerSheetsAnalysisCommand(parent: Command) {
  const filter = parent
    .command('filter')
    .description("Read and write a tab's filter");

  filter
    .command('get <doc-id>')
    .description("Get the tab's filter state")
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/filter`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getFilter(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  filter
    .command('set <doc-id>')
    .description(
      'Set the filter (JSON object from stdin or --data; null clears it)',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Filter state as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      const payload = await readPayload(dataStr, 'filter');
      if (!payload.ok) {
        outputError(new Error(payload.message), this);
        return;
      }
      // Unwrapped ahead of the dry-run branch so `filter get | filter set`
      // round-trips and the preview is the body that would go on the wire.
      const filterState = unwrap(
        payload.value,
        'filter',
      ) as WorksheetFilterState | null;

      try {
        // Inside the try, ahead of `--format` validation: the preview is
        // built from ids, and `seg()` refuses a `.` / `..` one. That refusal
        // has to reach `outputError` as the error envelope rather than
        // escape the handler as a rejected action promise.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/filter`,
            { filter: filterState },
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setFilter(docId, tab, filterState);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  const pivot = parent
    .command('pivot')
    .description("Read and write a tab's pivot table");

  pivot
    .command('get <doc-id>')
    .description("Get the tab's pivot table definition")
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/pivot`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getPivot(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  pivot
    .command('set <doc-id>')
    .description(
      'Set the pivot table (JSON object from stdin or --data; null clears it)',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Pivot table definition as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      const payload = await readPayload(dataStr, 'pivot');
      if (!payload.ok) {
        outputError(new Error(payload.message), this);
        return;
      }
      // Unwrapped ahead of the dry-run branch, as `filter set` does.
      const pivotTable = unwrap(
        payload.value,
        'pivot',
      ) as PivotTableDefinition | null;

      try {
        // Inside the try, ahead of `--format` validation — see `filter set`.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/pivot`,
            { pivot: pivotTable },
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setPivot(docId, tab, pivotTable);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
