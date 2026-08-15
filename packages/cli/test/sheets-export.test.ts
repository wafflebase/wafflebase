import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../src/commands/root.js';
import { registerSheetsCommand } from '../src/commands/sheets.js';

/**
 * `sheets export` writes a data file, not a human render. The CSV
 * formula neutralization that protects `--format csv` must not reach
 * it: the documented pipeline exports a sheet and re-imports it
 * (`skills/recipe-csv-pipeline.md`), so a `'` prefixed onto every
 * `=SUM(...)` would turn formulas into literal text on the way back in.
 */
const getCells = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    getCells = (...a: unknown[]) => getCells(...a);
  },
}));

function run(argv: string[]) {
  const program = createProgram();
  registerSheetsCommand(program);
  return program.parseAsync(
    [
      '--server',
      'https://api.example.test',
      '--workspace',
      'ws-1',
      '--api-key',
      'wfb_test',
      ...argv,
    ],
    { from: 'user' },
  );
}

describe('sheets export --file-format csv', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfb-export-'));
    getCells.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('exports formulas verbatim, so export → import round-trips', async () => {
    getCells.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        { ref: 'E2', value: '42', formula: '=SUM(B2:B100)' },
        { ref: 'E3', value: '-7', formula: '' },
      ],
    });

    const file = join(dir, 'out.csv');
    await run(['sheets', 'export', 'doc-1', file]);

    const written = readFileSync(file, 'utf-8');
    expect(written).toContain('=SUM(B2:B100)');
    expect(written).not.toContain("'=SUM(B2:B100)");
    expect(written).not.toContain("'-7");
  });
});
