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
import type { SheetChart } from '../client/http-client.js';

/**
 * Worksheet charts — the `charts` collection of one spreadsheet tab.
 *
 * `get` reads it; `set` REPLACES it. The endpoint is keyed by each chart's
 * `id`, so a chart missing from the payload is deleted — which is why `set`
 * is registered as `destructive` in the schema registry rather than `write`,
 * and why the help string says "Replace".
 */
export function registerSheetsChartsCommand(parent: Command) {
  const charts = parent
    .command('charts')
    .alias('chart')
    .description('Read and write worksheet charts');

  charts
    .command('get <doc-id>')
    .description('Get the charts on a spreadsheet tab')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/charts`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getCharts(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  charts
    .command('set <doc-id>')
    .description(
      'Replace all charts on a tab (JSON from stdin or --data; omitted charts are deleted)',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Chart data as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      // Parse inside a try: a malformed `--data`/stdin payload is user
      // input, and the message has to name which one it came from.
      // `runCli` would envelope an uncaught `SyntaxError` anyway, but
      // as a bare "Unexpected token …" with no mention of `--data` or
      // stdin, and it has to be caught here to add that.
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
        outputError(
          new Error(
            `Invalid JSON chart data${dataStr ? ' in --data' : ' on stdin'}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
          this,
        );
        return;
      }

      // Both spellings are accepted so `charts get` output pipes straight back
      // into `charts set`: GET answers `{ "charts": [...] }`, while the bare
      // array is the payload shape `cells batch` established. Unwrapped here,
      // BEFORE the dry-run branch, because the printed body is the wire body —
      // previewing `{ charts: { charts: [...] } }` would preview a request the
      // server rejects with a 400, and the shape check has to fail the same way
      // whether or not `--dry-run` was passed.
      const list =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as { charts?: unknown }).charts
          : parsed;
      if (!Array.isArray(list)) {
        outputError(
          new Error(
            `Invalid chart data${dataStr ? ' in --data' : ' on stdin'}: ` +
              'expected a JSON array of charts, or an object { "charts": [ ... ] }.',
          ),
          this,
        );
        return;
      }
      const chartList = list as SheetChart[];

      try {
        // Inside the try, ahead of `--format` validation: the preview is
        // built from ids, and `seg()` refuses a `.` / `..` one. That refusal
        // has to reach `outputError` as the error envelope rather than
        // escape the handler as a rejected action promise.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/charts`,
            { charts: chartList },
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setCharts(docId, tab, chartList);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
