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

export function registerTabsCommand(parent: Command) {
  const tab = parent.command('tabs').alias('tab').description('Manage tabs');

  tab
    .command('list <doc-id>')
    .description('List tabs in a document')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'GET', `/documents/${seg(docId)}/tabs`);
        return;
      }
      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).listTabs(docId);
        if (!res.ok) return forwardUpstreamError(res, this);
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
        printDryRun(
          getConfig(opts),
          'POST',
          `/documents/${seg(docId)}/tabs`,
          body,
        );
        return;
      }
      try {
        // Narrowed before the request: a rejected `--format` must not
        // discard the response of a tab that already exists server-side.
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).createTab(docId, body);
        if (!res.ok) return forwardUpstreamError(res, this);
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
        printDryRun(
          getConfig(opts),
          'PATCH',
          `/documents/${seg(docId)}/tabs/${seg(tabId)}`,
          { name },
        );
        return;
      }
      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).renameTab(docId, tabId, name);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  tab
    .command('delete <doc-id> <tab-id>')
    .description('Delete a tab and its grid (refuses the last remaining tab)')
    .action(async function (this: Command, docId: string, tabId: string) {
      const opts = getGlobalOpts(this);
      try {
        // Inside the try: the preview path is built from ids and `seg()`
        // refuses a `.` / `..` one, so that refusal has to reach
        // `outputError` as the error envelope rather than escape the handler.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'DELETE',
            `/documents/${seg(docId)}/tabs/${seg(tabId)}`,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).deleteTab(docId, tabId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  tab
    .command('move <doc-id> <tab-id> <index>')
    .description('Move a tab to a 1-based position in the tab bar')
    .action(async function (
      this: Command,
      docId: string,
      tabId: string,
      indexArg: string,
    ) {
      const opts = getGlobalOpts(this);
      // Parsed before the dry run: previewing `{ "index": null }` would
      // preview a request the server rejects.
      const index = Number(indexArg);
      if (!Number.isInteger(index) || index < 1) {
        outputError(
          new Error(
            `Invalid index "${indexArg}". Use a positive integer (1 = first tab).`,
          ),
          this,
        );
        return;
      }
      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'POST',
            `/documents/${seg(docId)}/tabs/${seg(tabId)}/reorder`,
            { index },
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).moveTab(docId, tabId, index);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  tab
    .command('duplicate <doc-id> <tab-id> [name]')
    .description(
      'Copy a tab and its grid next to it (name defaults to "<tab> (copy)"; comments are not carried over)',
    )
    .action(async function (
      this: Command,
      docId: string,
      tabId: string,
      name?: string,
    ) {
      const opts = getGlobalOpts(this);
      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'POST',
            `/documents/${seg(docId)}/tabs/${seg(tabId)}/duplicate`,
            name ? { name } : {},
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).duplicateTab(docId, tabId, name);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
