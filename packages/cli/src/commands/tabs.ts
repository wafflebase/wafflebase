import { Command } from 'commander';
import { getGlobalOpts, getClient } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
} from '../output/formatter.js';

export function registerTabsCommand(parent: Command) {
  const tab = parent.command('tabs').alias('tab').description('Manage tabs');

  tab
    .command('list <doc-id>')
    .description('List tabs in a document')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).listTabs(docId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, fmt, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });
}
