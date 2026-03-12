import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import { output, outputError } from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';

export function registerDocumentCommand(program: Command) {
  const doc = program.command('document').alias('doc').description('Manage documents');

  doc
    .command('list')
    .description('List documents in workspace')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        const res = await getClient(opts).listDocuments();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  doc
    .command('create <title>')
    .description('Create a new document')
    .action(async function (this: Command, title: string) {
      const opts = getGlobalOpts(this);
      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'POST', '/documents', { title });
        return;
      }
      try {
        const res = await getClient(opts).createDocument(title);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  doc
    .command('get <doc-id>')
    .description('Show document metadata')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      try {
        const res = await getClient(opts).getDocument(docId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  doc
    .command('rename <doc-id> <title>')
    .description('Rename a document')
    .action(async function (this: Command, docId: string, title: string) {
      const opts = getGlobalOpts(this);
      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'PATCH', `/documents/${docId}`, { title });
        return;
      }
      try {
        const res = await getClient(opts).updateDocument(docId, title);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  doc
    .command('delete <doc-id>')
    .description('Delete a document')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'DELETE', `/documents/${docId}`);
        return;
      }
      try {
        const res = await getClient(opts).deleteDocument(docId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });
}
