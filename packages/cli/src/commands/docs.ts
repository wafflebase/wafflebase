import { Command } from 'commander';
import { extname } from 'node:path';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import { output, outputError } from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { parseContentFormat, runDocsContent } from '../docs/content.js';
import { exportPdf } from '../docs/pdf-export.js';
import { exportDocx } from '../docs/docx-export.js';
import { parsePageRange } from '../docs/page-range.js';
import { writeBinary } from '../output/binary.js';
import { runDocsImport } from '../docs/import.js';

type DocType = 'doc' | 'sheet';

function parseType(value: string | undefined): DocType | undefined {
  if (value === undefined) return undefined;
  if (value !== 'doc' && value !== 'sheet') {
    throw new Error(`Invalid --type "${value}". Use "doc" or "sheet".`);
  }
  return value;
}

interface ContentOpts {
  pages?: string;
  includeHeaderFooter: boolean;
  inlineImages: boolean;
  out?: string;
  force: boolean;
}

const VALID_EXPORT_FORMATS = ['pdf', 'docx'] as const;
type ExportFormat = (typeof VALID_EXPORT_FORMATS)[number];

function detectExportFormat(file: string, formatFlag?: string): ExportFormat {
  if (formatFlag) {
    if (!VALID_EXPORT_FORMATS.includes(formatFlag as ExportFormat)) {
      throw new Error(
        `Invalid --format "${formatFlag}". Use one of: ${VALID_EXPORT_FORMATS.join(', ')}.`,
      );
    }
    return formatFlag as ExportFormat;
  }
  const ext = extname(file).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  throw new Error(
    `Cannot infer format from "${file}". Pass --format pdf|docx, or use a .pdf/.docx extension.`,
  );
}

interface ExportOpts {
  pages?: string;
  includeHeaderFooter: boolean;
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
    // NOTE: `--format` is intentionally not redeclared here. The global
    // `--format` option (declared in `createProgram`) catches the user's
    // value because commander resolves duplicate-named flags through the
    // earliest parent that owns them. Reading via `opts.format` (the
    // merged form) keeps a single source of truth and lets
    // `parseContentFormat` validate that the value is one of json|md|text.
    .option('--pages <range>', 'Page range to include (e.g. 1-3,5)')
    .option('--include-header-footer', 'Include header/footer (md/text)', false)
    .option('--inline-images', 'Inline data: image URLs (md only)', false)
    .option('--out <file>', 'Output file (- for stdout)')
    .option('--force', 'Overwrite existing output file', false)
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<ContentOpts>();
      try {
        const format = parseContentFormat(opts.format);

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

  doc
    .command('export <doc-id> <file>')
    .description('Export a document to PDF or DOCX')
    // NOTE: `--format` reuses the global option for the same reason
    // documented on `docs content` above; we route through `opts.format`
    // and let `detectExportFormat` distinguish a user-supplied value
    // from the implicit default by checking against the global default
    // (`'json'` — no PDF/DOCX user would pass that explicitly).
    .option('--pages <range>', 'Page range to export (PDF only)')
    .option('--include-header-footer', 'Include header/footer regions', true)
    .option('--force', 'Overwrite existing output file', false)
    .action(async function (this: Command, docId: string, file: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<ExportOpts>();
      try {
        // Treat the global `--format`'s default 'json' as "no override
        // intended" — extension wins. A real explicit `--format pdf`
        // / `--format docx` overrides; `--format json` would be invalid
        // for export and rejected by `detectExportFormat`.
        const formatOverride = opts.format === 'json' ? undefined : opts.format;
        const format = detectExportFormat(file, formatOverride);

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
            console.error(JSON.stringify(body, null, 2));
            process.exitCode = 1;
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const fetchedDoc = res.data;

        let bytes: Uint8Array;
        if (format === 'pdf') {
          // Pagination uses the FontkitMeasurer's coarse Latin estimate
          // when no Korean fonts are needed; we still pre-page to know
          // the document's page count for `parsePageRange`. PdfExporter
          // does the authoritative paint-time pagination internally.
          let pageRange = undefined;
          if (local.pages) {
            // Resolve pages against the rendered PDF's page count
            // (rather than running our own paginator twice). We render
            // the full PDF first, then strip non-selected pages —
            // see `extractPages` in pdf-export.ts.
            const fullPdf = await exportPdf(fetchedDoc, {
              includeHeaderFooter: local.includeHeaderFooter,
            });
            const total = await pdfPageCount(fullPdf);
            pageRange = parsePageRange(local.pages, total);
            if (!opts.quiet) {
              for (const w of pageRange.warnings) console.error(w);
            }
            bytes = await exportPdf(fetchedDoc, {
              includeHeaderFooter: local.includeHeaderFooter,
              pages: pageRange,
            });
          } else {
            bytes = await exportPdf(fetchedDoc, {
              includeHeaderFooter: local.includeHeaderFooter,
            });
          }
        } else {
          if (local.pages && !opts.quiet) {
            console.error(
              'DOCX has no page concept — exporting full document, --pages ignored.',
            );
          }
          bytes = await exportDocx(fetchedDoc, {
            includeHeaderFooter: local.includeHeaderFooter,
          });
        }

        writeBinary(bytes, file, { force: local.force, quiet: opts.quiet });
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });

  registerDocsImportCommand(doc);
}

async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPageCount();
}

interface ImportOpts {
  title?: string;
  replace?: string;
  yes: boolean;
}

export function registerDocsImportCommand(doc: Command) {
  doc
    .command('import <file>')
    .description('Import a .docx file as a new (or replacement) document')
    .option('--title <title>', 'Document title (default: file basename)')
    .option('--replace <doc-id>', 'Replace content of an existing document')
    .option('--yes', 'Skip --replace confirmation prompt', false)
    .action(async function (this: Command, file: string) {
      const opts = getGlobalOpts(this);
      const local = this.opts<ImportOpts>();
      try {
        const result = await runDocsImport(
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
