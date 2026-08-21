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
import { runFilesUpload } from '../files/upload.js';
import { runFilesDownload } from '../files/download.js';

/** Document types that are stored bytes rather than a CRDT. */
const BLOB_TYPES = new Set(['file', 'pdf', 'image']);

export function registerFilesCommand(program: Command) {
  const files = program
    .command('files')
    .alias('file')
    .description('Upload and download files stored as documents');

  files
    .command('upload <file>')
    .description('Upload any file as a document')
    .option(
      '--title <title>',
      'Document title (default: the filename, extension included)',
    )
    .option(
      '--folder <id>',
      'Folder to upload into (default: the workspace root)',
    )
    .action(async function (this: Command, file: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<{ title?: string; folder?: string }>();
      try {
        const result = await runFilesUpload(
          {
            file,
            title: local.title,
            folder: local.folder,
            quiet: opts.quiet,
            dryRun: opts.dryRun,
          },
          getClient(opts),
        );
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
      } catch (e) {
        outputError(e);
      }
    });

  files
    .command('download <doc-id> [out]')
    .description(
      'Download a file document (out: path, - for stdout; default: its filename)',
    )
    .option('--force', 'Overwrite existing output file', false)
    .action(async function (this: Command, docId: string, out?: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<{ force: boolean }>();
      try {
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'GET', `/files/${seg(docId)}`);
          return;
        }
        const result = await runFilesDownload(
          { docId, out, force: local.force, quiet: opts.quiet },
          getClient(opts),
        );
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
      } catch (e) {
        outputError(e);
      }
    });

  files
    .command('list')
    .description('List blob documents (file, pdf, image) in workspace')
    .option('--type <type>', 'Filter by a single type (file|pdf|image)')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      const local = this.opts<{ type?: string }>();
      try {
        const fmt = parseOutputFormat(opts.format);
        // Validated BEFORE the dry-run branch: a dry run validates inputs,
        // so a bad `--type` must still be an error rather than a preview.
        if (local.type && !BLOB_TYPES.has(local.type)) {
          throw new Error(
            `Invalid --type "${local.type}". Expected file, pdf, or image.`,
          );
        }
        if (opts.dryRun) {
          // The blob-type filter is applied client-side, so it leaves no
          // trace on the request the server would see.
          printDryRun(getConfig(opts), 'GET', '/documents');
          return;
        }
        const res = await getClient(opts).listDocuments();
        if (!res.ok) return forwardUpstreamError(res);
        let data = res.data as unknown;
        if (Array.isArray(data)) {
          data = (data as Array<{ type?: string }>).filter((d) =>
            local.type ? d.type === local.type : BLOB_TYPES.has(d.type ?? ''),
          );
        }
        output(data, fmt);
      } catch (e) {
        outputError(e);
      }
    });

  files
    .command('get <doc-id>')
    .description('Show file document metadata')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'GET', `/documents/${seg(docId)}`);
          return;
        }
        const res = await getClient(opts).getDocument(docId);
        if (!res.ok) return forwardUpstreamError(res);
        output(res.data, fmt);
      } catch (e) {
        outputError(e);
      }
    });

  files
    .command('rename <doc-id> <title>')
    .description('Rename a file document')
    .action(async function (this: Command, docId: string, title: string) {
      const opts = getGlobalOpts(this);
      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'PATCH', `/documents/${seg(docId)}`, {
          title,
        });
        return;
      }
      try {
        // Narrowed before the request: a rejected `--format` must not
        // discard the response of a rename that already happened.
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).updateDocument(docId, title);
        if (!res.ok) return forwardUpstreamError(res);
        output(res.data, fmt);
      } catch (e) {
        outputError(e);
      }
    });

  files
    .command('delete <doc-id>')
    .description('Delete a file document (and its stored bytes)')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'DELETE', `/documents/${seg(docId)}`);
        return;
      }
      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).deleteDocument(docId);
        if (!res.ok) return forwardUpstreamError(res);
        output(res.data, fmt);
      } catch (e) {
        outputError(e);
      }
    });
}
