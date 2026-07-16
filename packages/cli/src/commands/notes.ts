import { Command } from 'commander';
import { extname } from 'node:path';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import { output, outputError } from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
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
        const res = await getClient(opts).listDocuments();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let data = res.data as unknown;
        if (Array.isArray(data)) {
          data = (data as Array<{ type?: string }>).filter(
            (d) => d.type === 'note',
          );
        }
        output(data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  notes
    .command('create <title>')
    .description('Create a new note')
    .action(async function (this: Command, title: string) {
      const opts = getGlobalOpts(this);
      try {
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'POST', '/documents', {
            title,
            type: 'note',
          });
          return;
        }
        const res = await getClient(opts).createDocument(title, 'note');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  notes
    .command('get <doc-id>')
    .description('Show note metadata')
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

  notes
    .command('rename <doc-id> <title>')
    .description('Rename a note')
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

  notes
    .command('delete <doc-id>')
    .description('Delete a note')
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
          printDryRun(getConfig(opts), 'GET', `/documents/${docId}/content`);
          return;
        }

        const res = await getClient(opts).getNoteContent(docId);
        if (!res.ok) {
          const body = res.data as
            | { error?: { code?: string; message?: string } }
            | null;
          if (body?.error) {
            // Surface backend-shaped errors (e.g., TYPE_MISMATCH) verbatim
            // so agents reading stderr can act on the `code` field.
            console.error(JSON.stringify(body, null, 2));
            process.exitCode = 1;
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }

        runNotesContent({
          note: res.data,
          format,
          out: local.out,
          force: local.force,
          quiet: opts.quiet,
        });
      } catch (e) {
        outputError(e, opts.quiet);
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
          throw new Error(`Invalid --format "${fmt}". Only "md" is supported.`);
        }
        // `-` is stdout (advertised in the schema); no extension to infer.
        const ext = extname(file).toLowerCase();
        if (!fmt && file !== '-' && ext !== '.md' && ext !== '.markdown') {
          throw new Error(
            `Cannot infer format from "${file}". Use a .md extension or --format md.`,
          );
        }
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'GET', `/documents/${docId}/content`);
          return;
        }
        const res = await getClient(opts).getNoteContent(docId);
        if (!res.ok) {
          const body = res.data as { error?: { code?: string } } | null;
          if (body?.error) {
            console.error(JSON.stringify(body, null, 2));
            process.exitCode = 1;
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        runNotesContent({
          note: res.data,
          format: 'md',
          out: file,
          force: local.force,
          quiet: opts.quiet,
        });
      } catch (e) {
        outputError(e, opts.quiet);
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
        outputError(e, opts.quiet);
      }
    });
}
