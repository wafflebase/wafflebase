import { Command } from 'commander';
import { extname } from 'node:path';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  commandPath,
  InvalidFormatError,
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { seg } from '../client/url.js';
import { runSlidesImport } from '../slides/import.js';
import {
  parseSlidesContentFormat,
  runSlidesContent,
} from '../slides/content.js';
import { writeBinary } from '../output/binary.js';
import { createImageFetcher } from '../docs/image-fetcher.js';
import { exportPptxCli } from '../slides/pptx-export.js';
import { registerSlidesSetContentCommand } from './content-write.js';
import { registerSlidesEditCommand } from './slides-edit.js';

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
        const fmt = parseOutputFormat(opts.format);
        if (opts.dryRun) {
          // The `slides` filter is applied client-side, so it leaves no
          // trace on the request the server would see.
          printDryRun(getConfig(opts), 'GET', '/documents');
          return;
        }
        const res = await getClient(opts).listDocuments();
        if (!res.ok) return forwardUpstreamError(res, this);
        let data = res.data as unknown;
        if (Array.isArray(data)) {
          data = (data as Array<{ type?: string }>).filter(
            (d) => d.type === 'slides',
          );
        }
        output(data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  slides
    .command('create <title>')
    .description('Create a new slide deck')
    .action(async function (this: Command, title: string) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'POST', '/documents', {
            title,
            type: 'slides',
          });
          return;
        }
        const res = await getClient(opts).createDocument(title, 'slides');
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  slides
    .command('get <doc-id>')
    .description('Show slide deck metadata')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'GET', `/documents/${seg(docId)}`);
          return;
        }
        const res = await getClient(opts).getDocument(docId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  slides
    .command('rename <doc-id> <title>')
    .description('Rename a slide deck')
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
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  slides
    .command('delete <doc-id>')
    .description('Delete a slide deck')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      if (opts.dryRun) {
        printDryRun(getConfig(opts), 'DELETE', `/documents/${seg(docId)}`);
        return;
      }
      try {
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).deleteDocument(docId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
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
          printDryRun(
            getConfig(opts),
            'GET',
            `/documents/${seg(docId)}/content`,
          );
          return;
        }

        const res = await getClient(opts).getSlidesContent(docId);
        // Surfaces a backend-shaped error (e.g., TYPE_MISMATCH) verbatim so
        // agents reading stderr can act on its `code`; anything else throws
        // and comes back out through `outputError`.
        if (!res.ok) return forwardUpstreamError(res, this);

        runSlidesContent({
          deck: res.data,
          format,
          notes: local.notes,
          out: local.out,
          force: local.force,
          quiet: opts.quiet,
        });
      } catch (e) {
        outputError(e, this);
      }
    });

  slides
    .command('export <doc-id> <file>')
    .description('Export a slide deck to PPTX')
    // NOTE: `--format` is intentionally not redeclared here — the global
    // `--format` option catches the user's value (see the same comment on
    // `docs export`). We read `opts.format` via `getOptionValueSourceWithGlobals`
    // to distinguish an explicit CLI flag from the default, then validate
    // that only "pptx" is accepted.
    .option('--force', 'Overwrite existing output file', false)
    .action(async function (this: Command, docId: string, file: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<{ force: boolean }>();
      try {
        const formatSource = this.getOptionValueSourceWithGlobals('format');
        // Widen to `string` — `opts.format` is the global `OutputFormat`
        // union (json|table|csv|yaml), which has no overlap with the
        // export-only `pptx` value, so a direct comparison is a tsc error.
        const fmt: string | undefined =
          formatSource === 'cli' ? opts.format : undefined;
        if (fmt && fmt !== 'pptx') throw new InvalidFormatError(fmt, ['pptx']);
        if (!fmt && extname(file).toLowerCase() !== '.pptx') {
          throw new Error(`Cannot infer format from "${file}". Use a .pptx extension or --format pptx.`);
        }
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'GET',
            `/documents/${seg(docId)}/content`,
          );
          return;
        }
        const res = await getClient(opts).getSlidesContent(docId);
        if (!res.ok) return forwardUpstreamError(res, this);
        const imageFetcher = createImageFetcher({ serverBase: getConfig(opts).server });
        const bytes = await exportPptxCli(res.data, { imageFetcher });
        writeBinary(bytes, file, { force: local.force, quiet: opts.quiet });
      } catch (e) {
        outputError(e, this);
      }
    });

  registerSlidesImportCommand(slides);
  registerSlidesSetContentCommand(slides);
  registerSlidesEditCommand(slides);
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
            command: commandPath(this),
          },
          getClient(opts),
        );
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
      } catch (e) {
        outputError(e, this);
      }
    });
}
