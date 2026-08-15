import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../src/commands/root.js';
import { registerSheetsCommand } from '../src/commands/sheets.js';

/**
 * `sheets export` writes the CSV a user is most likely to open in a
 * spreadsheet app, and every cell in it was settable by any other member
 * of the workspace — so the formula guard is on by default. `--raw` opts
 * out for the documented round-trip pipeline
 * (`skills/recipe-csv-pipeline.md`), where a `'` prefixed onto every
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

  const cells = [
    { ref: 'E2', value: '42', formula: '=SUM(B2:B100)' },
    { ref: 'E3', value: '-7', formula: '' },
  ];

  it('exports formulas verbatim under --raw, so export → import round-trips', async () => {
    getCells.mockResolvedValue({ ok: true, status: 200, data: cells });

    const file = join(dir, 'out.csv');
    await run(['sheets', 'export', 'doc-1', file, '--raw']);

    const written = readFileSync(file, 'utf-8');
    expect(written).toContain('=SUM(B2:B100)');
    expect(written).not.toContain("'=SUM(B2:B100)");
    expect(written).not.toContain("'-7");
  });

  // Default is the safe one: this file gets opened in Excel, and any
  // co-member of the workspace could have planted the formula in it.
  it('neutralizes formulas by default', async () => {
    getCells.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        { ref: 'A1', value: '=HYPERLINK("http://evil","x")', formula: '' },
        ...cells,
      ],
    });

    const file = join(dir, 'out.csv');
    await run(['sheets', 'export', 'doc-1', file]);

    const written = readFileSync(file, 'utf-8');
    expect(written).toContain("'=HYPERLINK");
    expect(written).toContain("'=SUM(B2:B100)");
    // A plain negative number is arithmetic, not a formula.
    expect(written).not.toContain("'-7");
  });
});

/**
 * `wafflebase schema` is the agent-facing interface: an agent decides
 * what it can pass by reading it, so a flag that changes output
 * semantics and is missing there is a flag agents cannot reach.
 * Asserting parity against commander's own option list — rather than
 * spot-checking one name — is what makes the next flag added to this
 * command fail here instead of shipping undiscoverable.
 */
describe('sheets export schema parity', () => {
  it('registers every command-line flag in the schema registry', async () => {
    const { getCommandSchema } = await import('../src/schema/registry.js');
    const program = createProgram();
    registerSheetsCommand(program);

    const sheets = program.commands.find((c) => c.name() === 'sheets')!;
    const exportCmd = sheets.commands.find((c) => c.name() === 'export')!;
    const flags = exportCmd.options.map((o) => o.long).filter(Boolean);

    const schema = getCommandSchema('sheets.export')!;
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(Object.keys(schema.parameters)).toContain(flag);
    }
  });
});
