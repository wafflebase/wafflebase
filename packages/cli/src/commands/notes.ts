import { Command } from 'commander';
import { extname } from 'node:path';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  InvalidFormatError,
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { seg } from '../client/url.js';
import { runNotesImport } from '../notes/import.js';
import {
  parseNotesContentFormat,
  runNotesContent,
} from '../notes/content.js';

interface NotesImportOpts {
  title?: string;
  replace?: string;
  yes: boolean;
}

interface NotesContentOpts {
  out?: string;
  force: boolean;
}

export function registerNotesCommand(program: Command) {
  const notes = program
    .command('notes')
    .alias('note')
    .description('Manage markdown notes');

  notes
    .command('list')
    .description('List notes in workspace')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        if (opts.dryRun) {
          // The `note` filter is applied client-side, so it leaves no trace
          // on the request the server would see.
          printDryRun(getConfig(opts), 'GET', '/documents');
          return;
        }
        const res = await getClient(opts).listDocuments();
        if (!res.ok) return forwardUpstreamError(res);
        let data = res.data as unknown;
        if (Array.isArray(data)) {
          data = (data as Array<{ type?: string }>).filter(
            (d) => d.type === 'note',
          );
        }
        output(data, fmt);
      } catch (e) {
        outputError(e);
      }
    });

  notes
    .command('create <title>')
    .description('Create a new note')
    .action(async function (this: Command, title: string) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'POST', '/documents', {
            title,
            type: 'note',
          });
          return;
        }
        const res = await getClient(opts).createDocument(title, 'note');
        if (!res.ok) return forwardUpstreamError(res);
        output(res.data, fmt);
      } catch (e) {
        outputError(e);
      }
    });

  notes
    .command('get <doc-id>')
    .description('Show note metadata')
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

  notes
    .command('rename <doc-id> <title>')
    .description('Rename a note')
    .action(async function (this: Command, docId: string, title: string) {
      const opts = getGlobalOpts(this);
      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'PATCH', `/documents/${seg(docId)}`, {
          title,
        });
        return;
      }
      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).updateDocument(docId, title);
        if (!res.ok) return forwardUpstreamError(res);
        output(res.data, fmt);
      } catch (e) {
        outputError(e);
      }
    });

  notes
    .command('delete <doc-id>')
    .description('Delete a note')
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

  notes
    .command('content <doc-id>')
    .description('Read note content as JSON or Markdown')
    // NOTE: `--format` is intentionally not redeclared here — the global
    // `--format` option catches the user's value (see the same comment on
    // `docs content` / `slides content`). We read `opts.format` and validate
    // it through `parseNotesContentFormat`.
    .option('--out <file>', 'Output file (- for stdout)')
    .option('--force', 'Overwrite existing output file', false)
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<NotesContentOpts>();
      try {
        const format = parseNotesContentFormat(opts.format);

        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'GET',
            `/documents/${seg(docId)}/content`,
          );
          return;
        }

        const res = await getClient(opts).getNoteContent(docId);
        // Surfaces a backend-shaped error (e.g., TYPE_MISMATCH) verbatim so
        // agents reading stderr can act on its `code`; anything else throws
        // and comes back out through `outputError`.
        if (!res.ok) return forwardUpstreamError(res);

        runNotesContent({
          note: res.data,
          format,
          out: local.out,
          force: local.force,
          quiet: opts.quiet,
        });
      } catch (e) {
        outputError(e);
      }
    });

  notes
    .command('export <doc-id> <file>')
    .description('Export a note to Markdown')
    // NOTE: `--format` is intentionally not redeclared here — the global
    // `--format` option catches the user's value. We read it via
    // `getOptionValueSourceWithGlobals` to tell an explicit CLI flag from
    // the default, then validate that only "md" is accepted.
    .option('--force', 'Overwrite existing output file', false)
    .action(async function (this: Command, docId: string, file: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<{ force: boolean }>();
      try {
        const formatSource = this.getOptionValueSourceWithGlobals('format');
        // Widen to `string` — `opts.format` is the global `OutputFormat`
        // union (json|table|csv|yaml), which has no overlap with the
        // export-only `md` value, so a direct comparison is a tsc error.
        const fmt: string | undefined =
          formatSource === 'cli' ? opts.format : undefined;
        if (fmt && fmt !== 'md' && fmt !== 'markdown') {
          throw new InvalidFormatError(fmt, ['md']);
        }
        // `-` is stdout (advertised in the schema); no extension to infer.
        const ext = extname(file).toLowerCase();
        if (!fmt && file !== '-' && ext !== '.md' && ext !== '.markdown') {
          throw new Error(
            `Cannot infer format from "${file}". Use a .md extension or --format md.`,
          );
        }
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'GET',
            `/documents/${seg(docId)}/content`,
          );
          return;
        }
        const res = await getClient(opts).getNoteContent(docId);
        if (!res.ok) return forwardUpstreamError(res);
        runNotesContent({
          note: res.data,
          format: 'md',
          out: file,
          force: local.force,
          quiet: opts.quiet,
        });
      } catch (e) {
        outputError(e);
      }
    });

  registerNotesImportCommand(notes);
}

export function registerNotesImportCommand(notes: Command) {
  notes
    .command('import <file>')
    .description('Import a Markdown file as a new (or replacement) note')
    .option('--title <title>', 'Note title (default: file basename)')
    .option('--replace <doc-id>', 'Replace content of an existing note')
    .option('--yes', 'Skip --replace confirmation prompt', false)
    .action(async function (this: Command, file: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<NotesImportOpts>();
      try {
        const result = await runNotesImport(
          {
            file,
            title: local.title,
            replace: local.replace,
            yes: local.yes,
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
}
