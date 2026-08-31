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
import type { CellStyle, RangeStylePatch } from '../client/http-client.js';
import { isPlainObject, unwrap } from './payload.js';

/**
 * Worksheet formatting: the range-style layer (`styles`), the single
 * sheet-wide style (`sheet-style`), and the whole-column / whole-row style
 * maps (`column-styles` / `row-styles`). Each group is a `get` / `set` pair
 * over the matching `/tabs/:tabId/<resource>` GET+PUT endpoints.
 *
 * The `set` side reads JSON from stdin or `--data`, exactly like
 * `sheets cells batch`. It accepts either the bare value or the same envelope
 * the matching `get` prints (`{ rangeStyles: [...] }`, `{ style: {...} }`, …),
 * so `wafflebase sheets styles get <doc> | wafflebase sheets styles set <doc>`
 * round-trips.
 */

type JsonPayload =
  | { ok: true; value: unknown }
  | { ok: false; value?: undefined };

/**
 * Read a JSON payload from `--data` or stdin. The parse is caught here rather
 * than left to `runCli` so the message can name which source the bad JSON came
 * from — the same reason `sheets cells batch` catches its own.
 */
async function readJsonPayload(
  cmd: Command,
  dataStr: string | undefined,
  what: string,
): Promise<JsonPayload> {
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
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    outputError(
      new Error(
        `Invalid JSON ${what}${dataStr ? ' in --data' : ' on stdin'}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ),
      cmd,
    );
    return { ok: false };
  }
}

/**
 * Validate an index-keyed style map (`{ "1": { bold: true }, "2": null }`).
 * Keys are the 1-based column/row index as a string and a `null` value clears
 * that index, mirroring the server's own parser. Checked client-side so a
 * `--dry-run` never previews a body the server would reject with a 400.
 */
function indexKeyedStyleMapError(value: unknown, field: string): string | null {
  if (!isPlainObject(value)) {
    return `${field} must be a JSON object map of 1-based index to style (or null to clear).`;
  }
  for (const [key, style] of Object.entries(value)) {
    if (!/^[1-9]\d*$/.test(key)) {
      return `${field} keys must be 1-based integer indices; got "${key}".`;
    }
    if (style !== null && !isPlainObject(style)) {
      return `${field}["${key}"] must be a style object or null.`;
    }
  }
  return null;
}

export function registerSheetsStylesCommand(parent: Command) {
  registerRangeStyles(parent);
  registerSheetStyle(parent);
  registerColumnStyles(parent);
  registerRowStyles(parent);
}

function registerRangeStyles(parent: Command) {
  const styles = parent
    .command('styles')
    .alias('style')
    .alias('range-styles')
    .description('Read and write the range-style layer of a tab');

  styles
    .command('get <doc-id>')
    .description('Get the range styles of a tab')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/range-styles`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getRangeStyles(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  styles
    .command('set <doc-id>')
    .description(
      'Replace the range styles of a tab (JSON array from stdin or --data); omitted patches are deleted',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Range style patches as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      const payload = await readJsonPayload(this, dataStr, 'range styles');
      if (!payload.ok) return;

      const rangeStyles = unwrap(payload.value, 'rangeStyles');
      // Checked BEFORE the dry-run branch: a dry run that prints a body the
      // server would reject is worse than no dry run at all.
      if (!Array.isArray(rangeStyles)) {
        outputError(
          new Error(
            'Range styles must be a JSON array of { range, style } patches (or an object with a "rangeStyles" array).',
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
            `/documents/${seg(docId)}/tabs/${seg(tab)}/range-styles`,
            { rangeStyles },
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setRangeStyles(
          docId,
          tab,
          rangeStyles as RangeStylePatch[],
        );
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}

function registerSheetStyle(parent: Command) {
  const sheetStyle = parent
    .command('sheet-style')
    .description('Read and write the sheet-wide style of a tab');

  sheetStyle
    .command('get <doc-id>')
    .description('Get the sheet-wide style of a tab')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/sheet-style`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getSheetStyle(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  sheetStyle
    .command('set <doc-id>')
    .description(
      'Merge a style into the sheet-wide style (JSON from stdin or --data); null clears it',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Sheet style as JSON string (null clears)')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      const payload = await readJsonPayload(this, dataStr, 'sheet style');
      if (!payload.ok) return;

      // An explicit `null` clears the sheet style; the server rejects an
      // omitted `style` rather than treating it as a clear, so there is no
      // "no value given" path here either.
      const style = unwrap(payload.value, 'style');
      if (style !== null && !isPlainObject(style)) {
        outputError(
          new Error(
            'Sheet style must be a JSON object or null (null clears the sheet style).',
          ),
          this,
        );
        return;
      }

      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/sheet-style`,
            { style },
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setSheetStyle(
          docId,
          tab,
          style as CellStyle | null,
        );
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}

function registerColumnStyles(parent: Command) {
  const columnStyles = parent
    .command('column-styles')
    .alias('column-style')
    .description('Read and write whole-column styles of a tab');

  columnStyles
    .command('get <doc-id>')
    .description('Get the whole-column styles of a tab')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/column-styles`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getColumnStyles(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  columnStyles
    .command('set <doc-id>')
    .description(
      'Merge whole-column styles keyed by 1-based column index (JSON from stdin or --data); null clears an index',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Column styles as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      const payload = await readJsonPayload(this, dataStr, 'column styles');
      if (!payload.ok) return;

      const columnStyleMap = unwrap(payload.value, 'columnStyles');
      const invalid = indexKeyedStyleMapError(columnStyleMap, 'Column styles');
      if (invalid) {
        outputError(new Error(invalid), this);
        return;
      }

      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/column-styles`,
            { columnStyles: columnStyleMap },
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setColumnStyles(
          docId,
          tab,
          columnStyleMap as Record<string, CellStyle | null>,
        );
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}

function registerRowStyles(parent: Command) {
  const rowStyles = parent
    .command('row-styles')
    .alias('row-style')
    .description('Read and write whole-row styles of a tab');

  rowStyles
    .command('get <doc-id>')
    .description('Get the whole-row styles of a tab')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/row-styles`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getRowStyles(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  rowStyles
    .command('set <doc-id>')
    .description(
      'Merge whole-row styles keyed by 1-based row index (JSON from stdin or --data); null clears an index',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Row styles as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      const payload = await readJsonPayload(this, dataStr, 'row styles');
      if (!payload.ok) return;

      const rowStyleMap = unwrap(payload.value, 'rowStyles');
      const invalid = indexKeyedStyleMapError(rowStyleMap, 'Row styles');
      if (invalid) {
        outputError(new Error(invalid), this);
        return;
      }

      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/row-styles`,
            { rowStyles: rowStyleMap },
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setRowStyles(
          docId,
          tab,
          rowStyleMap as Record<string, CellStyle | null>,
        );
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
