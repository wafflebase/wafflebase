import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { getGlobalOpts, getClient } from './root.js';
import { outputError, forwardUpstreamError } from '../output/formatter.js';
import { formatCsv } from '../output/csv.js';
import { formatJson } from '../output/json.js';

const VALID_FORMATS = ['csv', 'json'] as const;

function detectFormat(file: string, formatFlag?: string): 'csv' | 'json' {
  if (formatFlag) {
    if (!VALID_FORMATS.includes(formatFlag as 'csv' | 'json')) {
      throw new Error(`Unsupported format "${formatFlag}". Use csv or json.`);
    }
    return formatFlag as 'csv' | 'json';
  }
  const ext = extname(file).toLowerCase();
  if (ext === '.json') return 'json';
  return 'csv';
}

export function registerSheetsExportCommand(parent: Command) {
  parent
    .command('export <doc-id> <file>')
    .description('Export tab data to CSV/JSON')
    .option('--tab <tab-id>', 'Source tab', 'tab-1')
    .option('--range <range>', 'Cell range to export (e.g. A1:D100)')
    .option('--file-format <fmt>', 'File format (csv, json)')
    .option(
      '--raw',
      'CSV only: write cell text verbatim, without the leading-quote ' +
        'formula guard, so `sheets import` round-trips formulas',
    )
    .action(async function (this: Command, docId: string, file: string) {
      const opts = getGlobalOpts(this);
      const localOpts = this.opts<{
        tab: string;
        range?: string;
        fileFormat?: string;
        raw?: boolean;
      }>();

      try {
        const res = await getClient(opts).getCells(docId, localOpts.tab, localOpts.range);
        // Forwards a backend envelope verbatim rather than lifting its
        // `message` out and dropping the `code` — the code is the part an
        // agent branches on.
        if (!res.ok) return forwardUpstreamError(res);

        const fmt = detectFormat(file, localOpts.fileFormat);
        // This writes the one CSV a user is most likely to open in a
        // spreadsheet app, and every cell in it was settable by any other
        // member of the workspace, so the formula guard is *on* by
        // default: an exported `=HYPERLINK("http://evil","x")` must not
        // execute on open. `--raw` opts out for the round-trip pipeline
        // (skills/recipe-csv-pipeline.md), where an exported
        // `=SUM(B2:B100)` has to re-import as that formula rather than as
        // the literal text `'=SUM(B2:B100)`. Opting out is the caller
        // saying they trust the sheet, which is not ours to assume.
        const formatted =
          fmt === 'csv'
            ? formatCsv(res.data, { neutralizeFormulas: !localOpts.raw })
            : formatJson(res.data);

        if (file === '-') {
          process.stdout.write(formatted + '\n');
        } else {
          writeFileSync(file, formatted + '\n', 'utf-8');
          if (!opts.quiet) {
            console.log(`Exported to ${file}`);
          }
        }
      } catch (e) {
        outputError(e);
      }
    });
}
