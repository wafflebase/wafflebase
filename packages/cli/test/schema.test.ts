import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { createProgram } from '../src/commands/root.js';
import {
  registerSchemaCommand,
  toSchemaListPayload,
} from '../src/commands/schema.js';
import { format, type OutputFormat } from '../src/output/formatter.js';
import {
  getCommandSchema,
  getAllCommandSchemas,
} from '../src/schema/registry.js';

describe('schema command list output', () => {
  let stdout: string[];

  beforeEach(() => {
    stdout = [];
    vi.spyOn(console, 'log').mockImplementation((value) => {
      stdout.push(String(value));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runSchemaList(outputFormat: OutputFormat): Promise<string> {
    const program = createProgram();
    registerSchemaCommand(program);
    await program.parseAsync(['schema', '--format', outputFormat], {
      from: 'user',
    });
    expect(stdout).toHaveLength(1);
    return stdout[0];
  }

  it('keeps the commands envelope for JSON output', async () => {
    const result = JSON.parse(await runSchemaList('json')) as {
      commands: unknown[];
    };

    expect(result).toEqual({
      commands: expect.arrayContaining([
        expect.objectContaining({
          name: 'login',
          description: expect.any(String),
          safety: expect.any(String),
        }),
      ]),
    });
    expect(result.commands.length).toBeGreaterThan(0);
  });

  it('renders command summaries as table rows', async () => {
    const result = await runSchemaList('table');
    const lines = result.split('\n');

    expect(result).not.toBe('(no results)');
    expect(lines[0].trim().split(/\s{2,}/)).toEqual([
      'name',
      'description',
      'safety',
    ]);
    expect(lines).toHaveLength(getAllCommandSchemas().length + 2);
    expect(result).toContain('login');
  });

  it('renders command summaries as CSV rows', async () => {
    const result = await runSchemaList('csv');
    const lines = result.split('\n');

    expect(lines[0]).toBe('name,description,safety');
    expect(lines).toHaveLength(getAllCommandSchemas().length + 1);
    expect(lines[1]).toMatch(/^login,/);
    expect(result).not.toMatch(/^commands,/);
  });

  it('renders command summaries as YAML rows', async () => {
    const result = await runSchemaList('yaml');
    const rows = parseYaml(result) as Array<{
      name: string;
      description: string;
      safety: string;
    }>;

    expect(rows).toHaveLength(getAllCommandSchemas().length);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'login',
          description: expect.any(String),
          safety: expect.any(String),
        }),
      ]),
    );
  });
});

describe('empty schema command list output', () => {
  it('keeps an empty commands envelope for JSON', () => {
    expect(format(toSchemaListPayload([], 'json'), 'json')).toBe(
      '{\n  "commands": []\n}',
    );
  });

  it('reports no table results for an empty command list', () => {
    expect(format(toSchemaListPayload([], 'table'), 'table')).toBe(
      '(no results)',
    );
  });

  it('renders empty CSV for an empty command list', () => {
    expect(format(toSchemaListPayload([], 'csv'), 'csv')).toBe('');
  });
});

describe('schema registry', () => {
  it('returns all commands', () => {
    const all = getAllCommandSchemas();
    expect(all.length).toBeGreaterThan(0);
    for (const cmd of all) {
      expect(cmd.name).toBeTruthy();
      expect(cmd.safety).toMatch(/^(read-only|write|destructive)$/);
    }
  });

  it('canonical names are plural', () => {
    const names = getAllCommandSchemas().map((c) => c.name);
    expect(names).toContain('docs.list');
    expect(names).toContain('docs.create');
    expect(names).toContain('docs.content');
    expect(names).toContain('docs.export');
    expect(names).toContain('docs.import');
    expect(names).toContain('sheets.tabs.list');
    expect(names).toContain('sheets.cells.get');
    expect(names).toContain('sheets.cells.set');
    expect(names).toContain('sheets.cells.batch');
    expect(names).toContain('sheets.cells.delete');
    expect(names).toContain('sheets.import');
    expect(names).toContain('sheets.export');
    expect(names).toContain('slides.export');
    expect(names).toContain('api-keys.create');
    expect(names).toContain('api-keys.list');
    expect(names).toContain('api-keys.revoke');
  });

  it('returns undefined for unknown command', () => {
    expect(getCommandSchema('nonexistent')).toBeUndefined();
  });

  it('safety levels match the design contract', () => {
    expect(getCommandSchema('docs.list')!.safety).toBe('read-only');
    expect(getCommandSchema('docs.create')!.safety).toBe('write');
    expect(getCommandSchema('docs.delete')!.safety).toBe('destructive');
    expect(getCommandSchema('docs.content')!.safety).toBe('read-only');
    expect(getCommandSchema('docs.export')!.safety).toBe('read-only');
    expect(getCommandSchema('docs.import')!.safety).toBe('write');
    expect(getCommandSchema('sheets.cells.get')!.safety).toBe('read-only');
    expect(getCommandSchema('sheets.cells.set')!.safety).toBe('write');
    expect(getCommandSchema('sheets.cells.delete')!.safety).toBe('destructive');
    expect(getCommandSchema('sheets.import')!.safety).toBe('write');
    expect(getCommandSchema('sheets.export')!.safety).toBe('read-only');
    expect(getCommandSchema('slides.export')!.safety).toBe('read-only');
    expect(getCommandSchema('api-keys.revoke')!.safety).toBe('destructive');
  });

  describe('alias resolution', () => {
    it('legacy singular doc.* names resolve to docs.*', () => {
      expect(getCommandSchema('doc.list')?.name).toBe('docs.list');
      expect(getCommandSchema('doc.create')?.name).toBe('docs.create');
      expect(getCommandSchema('doc.delete')?.name).toBe('docs.delete');
    });

    it('legacy singular cell.* names resolve to sheets.cells.*', () => {
      expect(getCommandSchema('cell.get')?.name).toBe('sheets.cells.get');
      expect(getCommandSchema('cell.set')?.name).toBe('sheets.cells.set');
      expect(getCommandSchema('cell.batch')?.name).toBe('sheets.cells.batch');
      expect(getCommandSchema('cell.delete')?.name).toBe('sheets.cells.delete');
    });

    it('top-level import/export resolve to sheets.import/export', () => {
      expect(getCommandSchema('import')?.name).toBe('sheets.import');
      expect(getCommandSchema('export')?.name).toBe('sheets.export');
    });

    it('deck.export and slide.export resolve to slides.export', () => {
      expect(getCommandSchema('deck.export')?.name).toBe('slides.export');
      expect(getCommandSchema('slide.export')?.name).toBe('slides.export');
      expect(getCommandSchema('decks.export')?.name).toBe('slides.export');
    });

    it('legacy api-key.* resolves to api-keys.*', () => {
      expect(getCommandSchema('api-key.create')?.name).toBe('api-keys.create');
      expect(getCommandSchema('api-key.list')?.name).toBe('api-keys.list');
      expect(getCommandSchema('api-key.revoke')?.name).toBe('api-keys.revoke');
    });

    it('legacy tab.list resolves to sheets.tabs.list', () => {
      expect(getCommandSchema('tab.list')?.name).toBe('sheets.tabs.list');
    });

    it('partial-namespace forms (cells.get, sheets.cell.get) resolve too', () => {
      expect(getCommandSchema('cells.get')?.name).toBe('sheets.cells.get');
      expect(getCommandSchema('sheets.cell.get')?.name).toBe('sheets.cells.get');
    });
  });

  describe('docs.import variants', () => {
    it('exposes write/destructive variants for default vs --replace', () => {
      const entry = getCommandSchema('docs.import')!;
      expect(entry.variants).toBeDefined();
      const variants = entry.variants!;
      expect(variants.find((v) => v.when === 'default')?.safety).toBe('write');
      expect(variants.find((v) => v.when === '--replace given')?.safety).toBe(
        'destructive',
      );
    });
  });

  describe('docs.list and docs.create flags', () => {
    it('docs.list documents the --type filter', () => {
      const params = getCommandSchema('docs.list')!.parameters;
      expect(params['--type']).toBeDefined();
    });

    it('docs.create documents the --type flag with default sheet', () => {
      const params = getCommandSchema('docs.create')!.parameters;
      expect(params['--type']).toBeDefined();
      expect(params['--type'].default).toBe('sheet');
    });
  });
});
