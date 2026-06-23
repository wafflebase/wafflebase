import { Command } from 'commander';
import { extname } from 'node:path';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import { output, outputError } from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { runSlidesImport } from '../slides/import.js';
import {
  parseSlidesContentFormat,
  runSlidesContent,
} from '../slides/content.js';
import { writeBinary } from '../output/binary.js';
import { createImageFetcher } from '../docs/image-fetcher.js';
import { exportPptxCli } from '../slides/pptx-export.js';

interface SlidesImportOpts {
  title?: string;
  replace?: string;
  yes: boolean;
}

interface SlidesContentOpts {
  notes: boolean;
  out?: string;
  force: boolean;
}

export function registerSlidesCommand(program: Command) {
  const slides = program
    .command('slides')
    .alias('slide')
    .alias('deck')
    .description('Manage slide decks');

  slides
    .command('list')
    .description('List slide decks in workspace')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        const res = await getClient(opts).listDocuments();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let data = res.data as unknown;
        if (Array.isArray(data)) {
          data = (data as Array<{ type?: string }>).filter(
            (d) => d.type === 'slides',
          );
        }
        output(data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  slides
    .command('create <title>')
    .description('Create a new slide deck')
    .action(async function (this: Command, title: string) {
      const opts = getGlobalOpts(this);
      try {
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'POST', '/documents', {
            title,
            type: 'slides',
          });
          return;
        }
        const res = await getClient(opts).createDocument(title, 'slides');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        output(res.data, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  slides
    .command('get <doc-id>')
    .description('Show slide deck metadata')
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

  slides
    .command('rename <doc-id> <title>')
    .description('Rename a slide deck')
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

  slides
    .command('delete <doc-id>')
    .description('Delete a slide deck')
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

  slides
    .command('content <doc-id>')
    .description('Read deck content as JSON, Markdown, or plain text')
    // NOTE: `--format` is intentionally not redeclared here — the global
    // `--format` option catches the user's value (see the same comment
    // on `docs content`). We read `opts.format` and validate it through
    // `parseSlidesContentFormat`.
    .option('--notes', 'Include speaker notes (md/text)', false)
    .option('--out <file>', 'Output file (- for stdout)')
    .option('--force', 'Overwrite existing output file', false)
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<SlidesContentOpts>();
      try {
        const format = parseSlidesContentFormat(opts.format);

        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'GET', `/documents/${docId}/content`);
          return;
        }

        const res = await getClient(opts).getSlidesContent(docId);
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

        runSlidesContent({
          deck: res.data,
          format,
          notes: local.notes,
          out: local.out,
          force: local.force,
          quiet: opts.quiet,
        });
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  slides
    .command('export <doc-id> <file>')
    .description('Export a slide deck to PPTX')
    .option('--force', 'Overwrite existing output file', false)
    .action(async function (this: Command, docId: string, file: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<{ force: boolean }>();
      try {
        const formatSource = this.getOptionValueSourceWithGlobals('format');
        const fmt = formatSource === 'cli' ? opts.format : undefined;
        if (fmt && fmt !== 'pptx') throw new Error(`Invalid --format "${fmt}". Only "pptx" is supported.`);
        if (!fmt && extname(file).toLowerCase() !== '.pptx') {
          throw new Error(`Cannot infer format from "${file}". Use a .pptx extension or --format pptx.`);
        }
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'GET', `/documents/${docId}/content`);
          return;
        }
        const res = await getClient(opts).getSlidesContent(docId);
        if (!res.ok) {
          const body = res.data as { error?: { code?: string } } | null;
          if (body?.error) { console.error(JSON.stringify(body, null, 2)); process.exitCode = 1; return; }
          throw new Error(`HTTP ${res.status}`);
        }
        const imageFetcher = createImageFetcher({ serverBase: getConfig(opts).server });
        const bytes = await exportPptxCli(res.data, { imageFetcher });
        writeBinary(bytes, file, { force: local.force, quiet: opts.quiet });
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  registerSlidesImportCommand(slides);
}

export function registerSlidesImportCommand(slides: Command) {
  slides
    .command('import <file>')
    .description(
      'Import a .pptx file as a new (or replacement) slides deck',
    )
    .option('--title <title>', 'Deck title (default: file basename)')
    .option('--replace <doc-id>', 'Replace content of an existing deck')
    .option('--yes', 'Skip --replace confirmation prompt', false)
    .action(async function (this: Command, file: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<SlidesImportOpts>();
      try {
        const result = await runSlidesImport(
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
