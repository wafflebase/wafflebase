import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import { output, outputError } from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';

export function registerCellCommand(program: Command) {
  const cell = program.command('cell').description('Read and write cells');

  cell
    .command('get <doc-id> [range]')
    .description('Get cells (default: all, or A1, or A1:C10)')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string, range?: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();
      try {
        const res = range?.includes(':')
          ? await getClient(opts).getCells(docId, tab, range)
          : range
            ? await getClient(opts).getCell(docId, tab, range)
            : await getClient(opts).getCells(docId, tab);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
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
        const res = await getClient(opts).setCell(
          docId,
          tab,
          ref,
          formula ? undefined : value,
          formula ? value : undefined,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
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
        const res = await getClient(opts).deleteCell(docId, tab, ref);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
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

      let cells: Record<string, unknown>;
      if (dataStr) {
        cells = JSON.parse(dataStr);
      } else {
        // Read from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer);
        }
        cells = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
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
        const res = await getClient(opts).batchCells(
          docId,
          tab,
          cells as Record<string, { value?: string; formula?: string } | null>,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });
}
