import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';

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
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  tab
    .command('create <doc-id> [name]')
    .description('Create a new sheet tab (name optional -> next SheetN)')
    .option('--type <type>', 'Tab type (only "sheet" is supported)', 'sheet')
    .action(async function (this: Command, docId: string, name?: string) {
      const opts = getGlobalOpts(this);
      const { type } = this.opts<{ type: string }>();
      // Checked BEFORE the dry-run branch, not just before the request: a
      // dry run that prints a body the server would reject is worse than no
      // dry run at all, since its whole job is to show what would happen.
      // `sheet` is the only type the REST endpoint accepts.
      if (type !== 'sheet') {
        outputError(
          new Error(`Unsupported tab type "${type}"; only "sheet" is supported.`),
          this,
        );
        return;
      }
      const body: { name?: string; type?: string } = { type };
      if (name !== undefined) body.name = name;

      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'POST', `/documents/${docId}/tabs`, body);
        return;
      }
      try {
        // Narrowed before the request: a rejected `--format` must not
        // discard the response of a tab that already exists server-side.
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).createTab(docId, body);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
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
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).renameTab(docId, tabId, name);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
