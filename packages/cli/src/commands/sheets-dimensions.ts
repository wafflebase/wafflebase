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

/**
 * Whole-column widths and whole-row heights for a spreadsheet tab.
 *
 * Both endpoints speak the same shape (see
 * `packages/backend/src/api/v1/worksheet-dimensions.controller.ts`): a map
 * keyed by the 1-based column/row index rendered as a string (`"1"` = column A
 * / the first row), whose values are positive numbers. A PUT **merges** per
 * index — an index the body does not mention keeps its stored size — and a
 * `null` value clears that index, reverting it to the tab's default dimension.
 *
 * The JSON read from `--data`/stdin is that bare map, exactly as
 * `sheets cells batch` takes the bare cell map; the `{ columnWidths }` /
 * `{ rowHeights }` envelope is the wire format and is added by `HttpClient`.
 */
type SizeMap = Record<string, number | null>;

/**
 * Read the payload from `--data` when given, otherwise from stdin, and parse
 * it. Throws whatever `JSON.parse` throws — the caller adds the source
 * attribution, since only it knows which flag its user reached for.
 */
async function readSizeMap(dataStr: string | undefined): Promise<SizeMap> {
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
  return JSON.parse(raw) as SizeMap;
}

export function registerSheetsDimensionsCommand(parent: Command) {
  const widths = parent
    .command('column-widths')
    .alias('column-width')
    .description('Read and write whole-column widths');

  widths
    .command('get <doc-id>')
    .description('Get column widths, keyed by 1-based column index')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/column-widths`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getColumnWidths(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  widths
    .command('set <doc-id>')
    .description(
      'Set column widths (JSON map of 1-based index to width, or null to clear; from stdin or --data)',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Column width data as JSON string')
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
      let columnWidths: SizeMap;
      try {
        columnWidths = await readSizeMap(dataStr);
      } catch (e) {
        outputError(
          new Error(
            `Invalid JSON column width data${dataStr ? ' in --data' : ' on stdin'}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
          this,
        );
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
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/column-widths`,
            { columnWidths },
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setColumnWidths(
          docId,
          tab,
          columnWidths,
        );
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  const heights = parent
    .command('row-heights')
    .alias('row-height')
    .description('Read and write whole-row heights');

  heights
    .command('get <doc-id>')
    .description('Get row heights, keyed by 1-based row index')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/row-heights`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getRowHeights(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  heights
    .command('set <doc-id>')
    .description(
      'Set row heights (JSON map of 1-based index to height, or null to clear; from stdin or --data)',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Row height data as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      // Same reasoning as `column-widths set`: the source of a malformed
      // payload is part of the message, so the parse is caught here rather
      // than left to `runCli`'s generic envelope.
      let rowHeights: SizeMap;
      try {
        rowHeights = await readSizeMap(dataStr);
      } catch (e) {
        outputError(
          new Error(
            `Invalid JSON row height data${dataStr ? ' in --data' : ' on stdin'}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
          this,
        );
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
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/row-heights`,
            { rowHeights },
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setRowHeights(docId, tab, rowHeights);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  return { widths, heights };
}
