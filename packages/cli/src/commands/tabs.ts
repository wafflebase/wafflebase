import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import { output, outputError } from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';

export function registerTabsCommand(parent: Command) {
  const tab = parent.command('tabs').alias('tab').description('Manage tabs');

  tab
    .command('list <doc-id>')
    .description('List tabs in a document')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      try {
        const res = await getClient(opts).listTabs(docId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format);
      } catch (e) {
        outputError(e);
      }
    });

  tab
    .command('create <doc-id> [name]')
    .description('Create a new sheet tab (name optional -> next SheetN)')
    .option('--type <type>', 'Tab type', 'sheet')
    .action(async function (this: Command, docId: string, name?: string) {
      const opts = getGlobalOpts(this);
      const { type } = this.opts<{ type: string }>();
      const body: { name?: string; type?: string } = { type };
      if (name !== undefined) body.name = name;

      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'POST', `/documents/${docId}/tabs`, body);
        return;
      }
      try {
        const res = await getClient(opts).createTab(docId, body);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  tab
    .command('rename <doc-id> <tab-id> <name>')
    .description('Rename a tab')
    .action(async function (
      this: Command,
      docId: string,
      tabId: string,
      name: string,
    ) {
      const opts = getGlobalOpts(this);

      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'PATCH', `/documents/${docId}/tabs/${tabId}`, {
          name,
        });
        return;
      }
      try {
        const res = await getClient(opts).renameTab(docId, tabId, name);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });
}
