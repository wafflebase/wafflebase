import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import { output, outputError } from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { parseContentFormat, runDocsContent } from '../docs/content.js';

type DocType = 'doc' | 'sheet';

function parseType(value: string | undefined): DocType | undefined {
  if (value === undefined) return undefined;
  if (value !== 'doc' && value !== 'sheet') {
    throw new Error(`Invalid --type "${value}". Use "doc" or "sheet".`);
  }
  return value;
}

interface ContentOpts {
  format: string;
  pages?: string;
  includeHeaderFooter: boolean;
  inlineImages: boolean;
  out?: string;
  force: boolean;
}

export function registerDocsCommand(program: Command) {
  const doc = program
    .command('docs')
    .alias('doc')
    .alias('document')
    .alias('documents')
    .description('Manage documents');

  doc
    .command('list')
    .description('List documents in workspace')
    .option('--type <type>', 'Filter by document type (doc|sheet)')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      const { type: typeStr } = this.opts<{ type?: string }>();
      try {
        const filterType = parseType(typeStr);
        const res = await getClient(opts).listDocuments();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let data = res.data as unknown;
        if (filterType && Array.isArray(data)) {
          data = (data as Array<{ type?: string }>).filter(
            (d) => (d.type ?? 'sheet') === filterType,
          );
        }
        output(data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  doc
    .command('create <title>')
    .description('Create a new document')
    .option('--type <type>', 'Document type (doc|sheet)', 'sheet')
    .action(async function (this: Command, title: string) {
      const opts = getGlobalOpts(this);
      const { type: typeStr } = this.opts<{ type: string }>();
      try {
        const type = parseType(typeStr) ?? 'sheet';
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'POST', '/documents', { title, type });
          return;
        }
        const res = await getClient(opts).createDocument(title, type);
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

  doc
    .command('content <doc-id>')
    .description('Read document content as JSON, Markdown, or plain text')
    .option('--format <fmt>', 'Output format (json|md|text)', 'json')
    .option('--pages <range>', 'Page range to include (e.g. 1-3,5)')
    .option('--include-header-footer', 'Include header/footer (md/text)', false)
    .option('--inline-images', 'Inline data: image URLs (md only)', false)
    .option('--out <file>', 'Output file (- for stdout)')
    .option('--force', 'Overwrite existing output file', false)
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<ContentOpts>();
      try {
        const format = parseContentFormat(local.format);

        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'GET',
            `/documents/${docId}/content`,
          );
          return;
        }

        const res = await getClient(opts).getDocContent(docId);
        if (!res.ok) {
          const body = res.data as { error?: { code?: string; message?: string } } | null;
          if (body?.error) {
            // Surface backend-shaped errors (e.g., TYPE_MISMATCH) verbatim
            // so agents reading stderr can act on the `code` field.
            console.error(JSON.stringify(body, null, 2));
            process.exitCode = 1;
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }

        runDocsContent({
          doc: res.data,
          format,
          pages: local.pages,
          includeHeaderFooter: local.includeHeaderFooter,
          inlineImages: local.inlineImages,
          out: local.out,
          force: local.force,
          quiet: opts.quiet,
        });
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });
}
