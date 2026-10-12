import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultLight, type SlidesDocument } from '@wafflebase/slides/node';
import { layoutRows, readDeckFile } from '../src/slides/lint.js';

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

describe('slides layout-report', () => {
  it('reads a .json deck, bare or wrapped as { document }', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'bare.json'), JSON.stringify(deck()));
    writeFileSync(join(dir, 'wrapped.json'), JSON.stringify({ document: deck() }));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ title: 'x' }));
    expect((await readDeckFile(join(dir, 'bare.json'))).slides).toHaveLength(1);
    expect((await readDeckFile(join(dir, 'wrapped.json'))).slides).toHaveLength(1);
    await expect(readDeckFile(join(dir, 'bad.json'))).rejects.toThrow(/not a slides document/);
  });

  it('flattens the layout report to one row per element', () => {
    const rows = layoutRows(deck());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ slide: 1, element: 'ok', type: 'text', lines: 1, overflows: false });
    expect(layoutRows(deck(), 2)).toEqual([]);
  });




});
