import { Command } from 'commander';
import { getGlobalOpts, getClient } from './root.js';
import { output, outputError } from '../output/formatter.js';

export function registerTabCommand(program: Command) {
  const tab = program.command('tab').description('Manage tabs');

  tab
    .command('list <doc-id>')
    .description('List tabs in a document')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      try {
        const res = await getClient(opts).listTabs(docId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });
}
