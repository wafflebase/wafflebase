import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { seg } from '../client/url.js';
import {
  parseCsv,
  parseStartRef,
  buildCellMap,
  buildCellMapFromTable,
  isCellTable,
} from '../util/csv-parse.js';

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

export function registerSheetsImportCommand(parent: Command) {
  parent
    .command('import <doc-id> <file>')
    .description('Import CSV/JSON into a tab')
    .option('--tab <tab-id>', 'Target tab', 'tab-1')
    .option('--file-format <fmt>', 'File format (csv, json)')
    .option(
      '--start <ref>',
      'Top-left cell for a positional grid (ignored for an exported ref,value,formula table, whose rows carry their own ref)',
      'A1',
    )
    .action(async function (this: Command, docId: string, file: string) {
      const opts = getGlobalOpts(this);
      const localOpts = this.opts<{
        tab: string;
        fileFormat?: string;
        start: string;
      }>();

      try {
        const outFmt = parseOutputFormat(opts.format);
        const fmt = detectFormat(file, localOpts.fileFormat);
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

        // `sheets export` writes one row per cell (`ref,value,formula,
        // style`), not a grid, so re-importing its output as a grid
        // filled A1 with the word "ref". Recognising that header is what
        // makes the export → import round trip an identity: with
        // `--raw`, a `=SUM(B2:B100)` comes back as that formula rather
        // than as text. Any other CSV is still a positional grid.
        //
        // Those rows carry their own `ref`, so `--start` has nothing to
        // place and does not apply. Which of the two ran is reported as
        // `mode`: the switch is a header heuristic on the *input*, not
        // something the caller asked for, so a `--start` that turned out
        // to be inert has to be visible in the result rather than
        // silently dropped.
        const cellTable = isCellTable(rows);
        const { row: startRow, col: startCol } = parseStartRef(localOpts.start);
        const cells = cellTable
          ? buildCellMapFromTable(rows)
          : buildCellMap(rows, startRow, startCol);
        const cellCount = Object.keys(cells).length;
        const mode = cellTable ? 'cells' : 'grid';

        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'PATCH', `/documents/${seg(docId)}/tabs/${seg(localOpts.tab)}/cells`, {
            cells,
          });
          return;
        }

        const res = await getClient(opts).batchCells(docId, localOpts.tab, cells);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = typeof res.data === 'object' && res.data !== null
          ? { imported: cellCount, mode, ...res.data as Record<string, unknown> }
          : { imported: cellCount, mode };
        output(result, outFmt);
      } catch (e) {
        outputError(e);
      }
    });
}
