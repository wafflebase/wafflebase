import { formatJson } from './json.js';
import { formatTable } from './table.js';
import { formatCsv } from './csv.js';

export type OutputFormat = 'json' | 'table' | 'csv';

export function format(data: unknown, fmt: OutputFormat): string {
  switch (fmt) {
    case 'json':
      return formatJson(data);
    case 'table':
      return formatTable(data);
    case 'csv':
      return formatCsv(data);
  }
}

export function output(data: unknown, fmt: OutputFormat, quiet: boolean) {
  if (quiet) return;
  console.log(format(data, fmt));
}

export function outputError(error: unknown, quiet: boolean) {
  if (quiet) {
    process.exitCode = 1;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({ error: { code: 'ERROR', message } }, null, 2),
  );
  process.exitCode = 1;
}
