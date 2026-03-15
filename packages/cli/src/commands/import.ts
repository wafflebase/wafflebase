import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import { output, outputError } from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { parseCsv, parseStartRef, buildCellMap } from '../util/csv-parse.js';

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

function readInput(file: string): string {
  if (file === '-') {
    return readFileSync(0, 'utf-8');
  }
  return readFileSync(file, 'utf-8');
}

export function registerImportCommand(program: Command) {
  program
    .command('import <doc-id> <file>')
    .description('Import CSV/JSON into a tab')
    .option('--tab <tab-id>', 'Target tab', 'tab-1')
    .option('--format <fmt>', 'File format (csv, json)')
    .option('--no-header', 'First row is NOT a header (CSV)')
    .option('--start <ref>', 'Top-left cell to start import', 'A1')
    .action(async function (this: Command, docId: string, file: string) {
      const opts = getGlobalOpts(this);
      const localOpts = this.opts<{
        tab: string;
        format?: string;
        header: boolean;
        start: string;
      }>();

      try {
        const fmt = detectFormat(file, localOpts.format);
        const raw = readInput(file);
        let rows: string[][];

        if (fmt === 'json') {
          const parsed = JSON.parse(raw);
          // Expect either array of arrays or array of objects
          if (Array.isArray(parsed) && parsed.length > 0) {
            if (Array.isArray(parsed[0])) {
              rows = parsed as string[][];
            } else if (typeof parsed[0] === 'object') {
              // Array of objects → header row + value rows
              const objs = parsed as Record<string, unknown>[];
              const keys = Object.keys(objs[0]);
              rows = [keys, ...objs.map((o) => keys.map((k) => String(o[k] ?? '')))];
            } else {
              throw new Error('JSON must be an array of arrays or array of objects');
            }
          } else {
            throw new Error('JSON must be a non-empty array');
          }
        } else {
          rows = parseCsv(raw);
        }

        if (rows.length === 0) {
          throw new Error('No data to import');
        }

        const { row: startRow, col: startCol } = parseStartRef(localOpts.start);
        const cells = buildCellMap(rows, startRow, startCol);
        const cellCount = Object.keys(cells).length;

        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'PATCH', `/documents/${docId}/tabs/${localOpts.tab}/cells`, {
            cells,
          });
          return;
        }

        const res = await getClient(opts).batchCells(docId, localOpts.tab, cells);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = typeof res.data === 'object' && res.data !== null
          ? { imported: cellCount, ...res.data as Record<string, unknown> }
          : { imported: cellCount };
        output(result, opts.format, opts.quiet);
      } catch (e) {
        outputError(e, opts.quiet);
      }
    });
}
