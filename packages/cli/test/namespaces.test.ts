import { describe, it, expect } from 'vitest';
import type { Command } from 'commander';
import { createProgram } from '../src/commands/root.js';
import { registerDocsCommand } from '../src/commands/docs.js';
import { registerSheetsCommand } from '../src/commands/sheets.js';
import { registerSlidesCommand } from '../src/commands/slides.js';
import { registerApiKeysCommand } from '../src/commands/api-keys.js';

function buildProgram(): Command {
  const p = createProgram();
  registerDocsCommand(p);
  registerSheetsCommand(p);
  registerSlidesCommand(p);
  registerApiKeysCommand(p);
  return p;
}

function findChild(parent: Command, name: string): Command | undefined {
  return parent.commands.find(
    (c) => c.name() === name || c.aliases().includes(name),
  );
}

describe('CLI namespace structure', () => {
  it('exposes plural top-level docs/sheets/api-keys namespaces', () => {
    const program = buildProgram();
    expect(findChild(program, 'docs')?.name()).toBe('docs');
    expect(findChild(program, 'sheets')?.name()).toBe('sheets');
    expect(findChild(program, 'api-keys')?.name()).toBe('api-keys');
  });

  it('docs accepts doc/document/documents aliases', () => {
    const program = buildProgram();
    const docs = findChild(program, 'docs');
    expect(docs?.aliases()).toEqual(
      expect.arrayContaining(['doc', 'document', 'documents']),
    );
  });

  it('sheets accepts sheet/spreadsheet/spreadsheets aliases', () => {
    const program = buildProgram();
    const sheets = findChild(program, 'sheets');
    expect(sheets?.aliases()).toEqual(
      expect.arrayContaining(['sheet', 'spreadsheet', 'spreadsheets']),
    );
  });

  it('api-keys accepts api-key alias', () => {
    const program = buildProgram();
    const apiKeys = findChild(program, 'api-keys');
    expect(apiKeys?.aliases()).toContain('api-key');
  });

  it('sheets contains tabs/cells/import/export with singular aliases', () => {
    const program = buildProgram();
    const sheets = findChild(program, 'sheets');
    expect(sheets).toBeDefined();
    const tabs = findChild(sheets!, 'tabs');
    const cells = findChild(sheets!, 'cells');
    expect(tabs?.name()).toBe('tabs');
    expect(tabs?.aliases()).toContain('tab');
    expect(cells?.name()).toBe('cells');
    expect(cells?.aliases()).toContain('cell');
    expect(findChild(sheets!, 'import')?.name()).toBe('import');
    expect(findChild(sheets!, 'export')?.name()).toBe('export');
  });

  it('removes top-level tab/cell/import/export commands', () => {
    const program = buildProgram();
    const topNames = program.commands.map((c) => c.name());
    expect(topNames).not.toContain('tab');
    expect(topNames).not.toContain('cell');
    expect(topNames).not.toContain('import');
    expect(topNames).not.toContain('export');
  });

  it('docs create exposes --type option defaulting to sheet', () => {
    const program = buildProgram();
    const docs = findChild(program, 'docs');
    expect(docs).toBeDefined();
    const create = findChild(docs!, 'create');
    expect(create).toBeDefined();
    const typeOpt = create!.options.find((o) => o.long === '--type');
    expect(typeOpt).toBeDefined();
    expect(typeOpt?.defaultValue).toBe('sheet');
  });

  it('docs list exposes --type option (no default)', () => {
    const program = buildProgram();
    const docs = findChild(program, 'docs');
    expect(docs).toBeDefined();
    const list = findChild(docs!, 'list');
    expect(list).toBeDefined();
    const typeOpt = list!.options.find((o) => o.long === '--type');
    expect(typeOpt).toBeDefined();
    expect(typeOpt?.defaultValue).toBeUndefined();
  });

  it('exposes the slides namespace with slide/deck aliases', () => {
    const program = buildProgram();
    const slides = findChild(program, 'slides');
    expect(slides?.name()).toBe('slides');
    expect(slides?.aliases()).toEqual(
      expect.arrayContaining(['slide', 'deck']),
    );
  });

  it('slides contains list/create/get/rename/delete/content/import/export', () => {
    const program = buildProgram();
    const slides = findChild(program, 'slides');
    expect(slides).toBeDefined();
    for (const sub of [
      'list',
      'create',
      'get',
      'rename',
      'delete',
      'content',
      'import',
      'export',
    ]) {
      expect(findChild(slides!, sub)?.name()).toBe(sub);
    }
  });
});
