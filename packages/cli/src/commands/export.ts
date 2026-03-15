import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { getGlobalOpts, getClient } from './root.js';
import { outputError } from '../output/formatter.js';
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

export function registerExportCommand(program: Command) {
  program
    .command('export <doc-id> <file>')
    .description('Export tab data to CSV/JSON')
    .option('--tab <tab-id>', 'Source tab', 'tab-1')
    .option('--range <range>', 'Cell range to export (e.g. A1:D100)')
    .option('--format <fmt>', 'Output format (csv, json)')
    .action(async function (this: Command, docId: string, file: string) {
      const opts = getGlobalOpts(this);
      const localOpts = this.opts<{
        tab: string;
        range?: string;
        format?: string;
      }>();

      try {
        const res = await getClient(opts).getCells(docId, localOpts.tab, localOpts.range);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const fmt = detectFormat(file, localOpts.format);
        const formatted = fmt === 'csv' ? formatCsv(res.data) : formatJson(res.data);

        if (file === '-') {
          process.stdout.write(formatted + '\n');
        } else {
          writeFileSync(file, formatted + '\n', 'utf-8');
          if (!opts.quiet) {
            console.log(`Exported to ${file}`);
          }
        }
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });
}
