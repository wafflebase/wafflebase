import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';

export function registerCellsCommand(parent: Command) {
  const cell = parent
    .command('cells')
    .alias('cell')
    .description('Read and write cells');

  cell
    .command('get <doc-id> [range]')
    .description('Get cells (default: all, or A1, or A1:C10)')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string, range?: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();
      try {
        const fmt = parseOutputFormat(opts.format);
        const res = range?.includes(':')
          ? await getClient(opts).getCells(docId, tab, range)
          : range
            ? await getClient(opts).getCell(docId, tab, range)
            : await getClient(opts).getCells(docId, tab);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  cell
    .command('set <doc-id> <ref> <value>')
    .description('Set a single cell value')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--formula', 'Treat value as a formula')
    .action(async function (
      this: Command,
      docId: string,
      ref: string,
      value: string,
    ) {
      const opts = getGlobalOpts(this);
      const { tab, formula } = this.opts<{ tab: string; formula: boolean }>();
      const body = formula ? { formula: value } : { value };

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'PUT',
          `/documents/${docId}/tabs/${tab}/cells/${ref}`,
          body,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setCell(
          docId,
          tab,
          ref,
          formula ? undefined : value,
          formula ? value : undefined,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  cell
    .command('delete <doc-id> <ref>')
    .description('Delete a single cell')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string, ref: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'DELETE',
          `/documents/${docId}/tabs/${tab}/cells/${ref}`,
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).deleteCell(docId, tab, ref);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  cell
    .command('batch <doc-id>')
    .description('Batch update cells (JSON from stdin or --data)')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Cell data as JSON string')
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
      let cells: Record<string, unknown>;
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
        cells = JSON.parse(raw) as Record<string, unknown>;
      } catch (e) {
        outputError(
          new Error(
            `Invalid JSON cell data${dataStr ? ' in --data' : ' on stdin'}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
        return;
      }

      if (opts.dryRun) {
        printDryRun(
          getConfig(opts),
          'PATCH',
          `/documents/${docId}/tabs/${tab}/cells`,
          { cells },
        );
        return;
      }

      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).batchCells(
          docId,
          tab,
          cells as Record<string, { value?: string; formula?: string } | null>,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
