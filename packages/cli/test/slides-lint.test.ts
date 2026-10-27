import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultLight, exportPptx, type SlidesDocument } from '@wafflebase/slides/node';
import { buildProgram } from '../src/cli.js';
import {
  layoutRows,
  parseFailOn,
  parseRules,
  readAllowlist,
  readDeckFile,
  runLint,
} from '../src/slides/lint.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'wfb-lint-'));

function deck(): SlidesDocument {
  const text = (id: string, x: number, y: number, body: string, color?: string) => ({
    id,
    type: 'text' as const,
    frame: { x, y, w: 600, h: 80, rotation: 0 },
    data: {
      blocks: [
        {
          id: `b-${id}`,
          type: 'paragraph' as const,
          inlines: [{ text: body, style: { fontSize: 24, ...(color ? { color } : {}) } }],
          style: {},
        },
      ],
    },
  });
  return {
    meta: { title: 't', themeId: defaultLight.id, masterId: 'm' },
    themes: [defaultLight],
    masters: [],
    layouts: [],
    guides: [],
    slides: [
      {
        id: 's1',
        layoutId: 'l',
        background: { fill: { kind: 'srgb', value: '#ffffff' } },
        elements: [text('ok', 200, 200, 'Readable'), text('pale', 200, 400, 'Pale', '#cccccc')],
        notes: [],
      },
    ],
  } as unknown as SlidesDocument;
}

describe('slides lint / layout-report', () => {
  it('reads a .json deck, bare or wrapped as { document }', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'bare.json'), JSON.stringify(deck()));
    writeFileSync(join(dir, 'wrapped.json'), JSON.stringify({ document: deck() }));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ title: 'x' }));
    expect((await readDeckFile(join(dir, 'bare.json'))).slides).toHaveLength(1);
    expect((await readDeckFile(join(dir, 'wrapped.json'))).slides).toHaveLength(1);
    await expect(readDeckFile(join(dir, 'bad.json'))).rejects.toThrow(/not a slides document/);
    for (const [name, body] of [['null.json', 'null'], ['num.json', '42'], ['str.json', '"x"']]) {
      writeFileSync(join(dir, name), body);
      await expect(readDeckFile(join(dir, name))).rejects.toThrow(/not a slides document/);
    }
  });

  it('reads a .pptx deck through the importer', async () => {
    const dir = tmp();
    const file = join(dir, 'deck.pptx');
    writeFileSync(file, await exportPptx(deck()));
    const doc = await readDeckFile(file);
    expect(doc.slides).toHaveLength(1);
    expect(layoutRows(doc).map((r) => r.type)).toContain('text');
  });

  it('flattens the layout report to one row per element', () => {
    const rows = layoutRows(deck());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ slide: 1, element: 'ok', type: 'text', lines: 1, overflows: false });
    expect(layoutRows(deck(), 2)).toEqual([]);
  });

  it('validates --rules and --fail-on', () => {
    expect(parseRules(undefined)).toBeUndefined();
    expect(parseRules('contrast, overlap')).toEqual(['contrast', 'overlap']);
    expect(() => parseRules('contrast,nope')).toThrow(/unknown rule/);
    expect(parseFailOn(undefined)).toBe('never');
    expect(parseFailOn('warning')).toBe('warning');
    expect(() => parseFailOn('fatal')).toThrow(/--fail-on/);
  });

  it('reports findings with the element text and stays advisory by default', () => {
    const r = runLint(deck(), { failOn: 'never' });
    expect(r.rows).toEqual([
      expect.objectContaining({ slide: 1, rule: 'contrast', severity: 'error', element: 'pale', text: 'Pale' }),
    ]);
    expect(r.exitCode).toBe(0);
    expect(runLint(deck(), { failOn: 'error' }).exitCode).toBe(1);
  });

  it('moves allowlisted findings out of the open rows', () => {
    const allowlist = [{ rule: 'contrast' as const, slideId: 's1', text: 'Pale', reason: 'decorative' }];
    const r = runLint(deck(), { failOn: 'error', allowlist });
    expect(r.rows).toEqual([]);
    expect(r.allowed).toHaveLength(1);
    expect(r.exitCode).toBe(0);
  });

  it('reports an allowlist entry as stale only when its slide and rule were linted', () => {
    const two = deck();
    two.slides.push({ ...two.slides[0], id: 's2' });
    const allowlist = [
      { rule: 'contrast' as const, slideId: 's2', text: 'Pale', reason: 'decorative' },
      { rule: 'overlap' as const, slideId: 's1', reason: 'intended' },
    ];
    // Unscoped: the s2 entry matches; the s1 overlap entry matches nothing.
    expect(runLint(two, { failOn: 'never', allowlist }).unused.map((e) => e.rule)).toEqual([
      'overlap',
    ]);
    // --slide 1 never looks at s2, so its entry is not stale.
    expect(
      runLint(two, { failOn: 'never', allowlist, slide: 1 }).unused.map((e) => e.slideId),
    ).toEqual(['s1']);
    // --rules contrast never runs overlap, so that entry is not stale either.
    expect(
      runLint(two, { failOn: 'never', allowlist, slide: 1, rules: ['contrast'] }).unused,
    ).toEqual([]);
  });

  it('requires a reason on every allowlist entry', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.json'), JSON.stringify([{ rule: 'contrast', slideId: 's1' }]));
    expect(() => readAllowlist(join(dir, 'a.json'))).toThrow(/non-empty reason/);
  });
});

describe('slides lint / layout-report: <doc-id> or --file', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;
  beforeEach(() => {
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = 0;
  });
  afterEach(() => {
    stderrSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it.each([
    ['neither', ['slides', 'lint']],
    ['both', ['slides', 'layout-report', 'doc-1', '--file', 'deck.json']],
  ])('refuses %s', async (_label, args) => {
    await buildProgram().parseAsync(['node', 'wafflebase', ...args]);
    expect(process.exitCode).toBe(1);
    expect(String(stderrSpy.mock.calls.at(-1)?.[0])).toContain(
      'pass exactly one of <doc-id> or --file <path>',
    );
  });
});
