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
import type { MergeSpan } from '../client/http-client.js';

/**
 * Worksheet view state — freeze panes, hidden rows/columns, merged cells.
 *
 * Each is a single field on the worksheet, so every endpoint is a GET/PUT pair
 * and every PUT *replaces* the field rather than merging into it. The write
 * side therefore takes the whole value as JSON (stdin or `--data`), the same
 * shape `sheets cells batch` uses, instead of per-field flags that would read
 * like a partial update the server does not perform.
 */
export function registerSheetsViewCommand(parent: Command) {
  registerFreezeCommand(parent);
  registerHiddenCommand(parent);
  registerMergesCommand(parent);
}

/**
 * Read the command's JSON payload from `--data` or stdin.
 *
 * Lifted out of the three `set` handlers because the parse is identical in all
 * of them, error message included: a malformed payload is user input and the
 * message has to name which source it came from. `runCli` would envelope an
 * uncaught `SyntaxError` anyway, but as a bare "Unexpected token …" with no
 * mention of `--data` or stdin, so it is caught here to add that.
 *
 * The error is emitted here rather than thrown so the caller keeps the house
 * "`outputError` then `return`" shape; a `false` result means the envelope has
 * already been written and the handler must stop.
 */
async function readJsonPayload(
  cmd: Command,
  dataStr: string | undefined,
  label: string,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false }> {
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
    return { ok: true, value: JSON.parse(raw) as Record<string, unknown> };
  } catch (e) {
    outputError(
      new Error(
        `Invalid JSON ${label} data${dataStr ? ' in --data' : ' on stdin'}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ),
      cmd,
    );
    return { ok: false };
  }
}

function registerFreezeCommand(parent: Command) {
  const freeze = parent
    .command('freeze')
    .description('Read and write frozen rows/columns');

  freeze
    .command('get <doc-id>')
    .description('Get the frozen row/column counts')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/freeze`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getFreeze(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  freeze
    .command('set <doc-id>')
    .description(
      'Set frozen rows/columns ({ "rows": n, "cols": n } from stdin or --data; an omitted key resets to 0)',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Freeze data as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      // Parsed before the dry-run branch: a malformed payload must not
      // preview a request that could never be sent.
      const parsed = await readJsonPayload(this, dataStr, 'freeze');
      if (!parsed.ok) return;
      const body = parsed.value as { rows?: number; cols?: number };

      try {
        // Inside the try, ahead of `--format` validation: the preview is
        // built from ids, and `seg()` refuses a `.` / `..` one. That refusal
        // has to reach `outputError` as the error envelope rather than
        // escape the handler as a rejected action promise.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/freeze`,
            body,
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setFreeze(docId, tab, body);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}

function registerHiddenCommand(parent: Command) {
  const hidden = parent
    .command('hidden')
    .description('Read and write hidden rows/columns');

  hidden
    .command('get <doc-id>')
    .description('Get the hidden row/column indices (1-based)')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/hidden`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getHidden(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  hidden
    .command('set <doc-id>')
    .description(
      'Set hidden rows/columns ({ "rows": [1], "columns": [2] } from stdin or --data; replaces the whole set, indices are 1-based)',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Hidden data as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      const parsed = await readJsonPayload(this, dataStr, 'hidden');
      if (!parsed.ok) return;
      const body = parsed.value as { rows?: number[]; columns?: number[] };

      try {
        // Inside the try, ahead of `--format` validation: the preview is
        // built from ids, and `seg()` refuses a `.` / `..` one. That refusal
        // has to reach `outputError` as the error envelope rather than
        // escape the handler as a rejected action promise.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/hidden`,
            body,
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setHidden(docId, tab, body);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}

function registerMergesCommand(parent: Command) {
  const merges = parent
    .command('merges')
    .alias('merge')
    .description('Read and write merged cells');

  merges
    .command('get <doc-id>')
    .description('Get merged cells as a map of anchor ref to { rs, cs }')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'GET',
          `/documents/${seg(docId)}/tabs/${seg(tab)}/merges`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getMerges(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  merges
    .command('set <doc-id>')
    .description(
      'Replace all merged cells ({ "A1": { "rs": 2, "cs": 2 } } from stdin or --data; omitted merges are removed)',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Merge map as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      // The payload is the merge *map* itself, matching the shape `merges get`
      // prints under its `merges` key and the argument `HttpClient.setMerges`
      // takes; the client is what wraps it in the `{ merges }` envelope the
      // endpoint expects.
      const parsed = await readJsonPayload(this, dataStr, 'merge');
      if (!parsed.ok) return;
      const merges = parsed.value as Record<string, MergeSpan>;

      try {
        // Inside the try, ahead of `--format` validation: the preview is
        // built from ids, and `seg()` refuses a `.` / `..` one. That refusal
        // has to reach `outputError` as the error envelope rather than
        // escape the handler as a rejected action promise.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/merges`,
            { merges },
          );
          return;
        }

        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setMerges(docId, tab, merges);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
