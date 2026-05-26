import yorkie, { Document as YorkieDocument } from '@yorkie-js/sdk';
import { readSlidesRoot, SlidesYorkieRoot, writeSlidesRoot } from './slides-tree';
import type { SlidesDocument } from './yorkie.types';

function makeDeck(): SlidesDocument {
  const theme = {
    id: 'default-light',
    name: 'Simple Light',
    colors: {
      text: '#202124',
      background: '#FFFFFF',
      textSecondary: '#5F6368',
      backgroundAlt: '#F1F3F4',
      accent1: '#1A73E8',
      accent2: '#34A853',
      accent3: '#FBBC04',
      accent4: '#EA4335',
      accent5: '#673AB7',
      accent6: '#FF6D01',
      hyperlink: '#1A73E8',
      visitedHyperlink: '#7B1FA2',
    },
    fonts: { heading: 'Inter', body: 'Inter' },
  };
  const master = {
    id: 'default',
    name: 'Default',
    background: { fill: { kind: 'role' as const, role: 'background' as const } },
    placeholderStyles: {},
  };
  return {
    meta: { title: 'Imported Deck', themeId: theme.id, masterId: master.id },
    themes: [theme],
    masters: [master],
    layouts: [
      {
        id: 'title-body',
        masterId: master.id,
        name: 'Title and body',
        placeholders: [],
        staticElements: [],
      },
    ],
    slides: [
      {
        id: 'slide-1',
        layoutId: 'title-body',
        background: { fill: { kind: 'role', role: 'background' } },
        elements: [
          {
            id: 's1-el1',
            type: 'text',
            frame: { x: 100, y: 100, w: 600, h: 80, rotation: 0 },
            data: {
              blocks: [
                {
                  id: 'b1',
                  type: 'paragraph',
                  inlines: [{ text: 'Hello slides', style: { bold: true } }],
                  style: {
                    alignment: 'left',
                    lineHeight: 1.2,
                    marginTop: 0,
                    marginBottom: 0,
                    textIndent: 0,
                    marginLeft: 0,
                  },
                },
              ],
            },
          },
        ],
        notes: [],
      },
    ],
    guides: [],
  } as unknown as SlidesDocument;
}

describe('slides-tree', () => {
  let doc: YorkieDocument<SlidesYorkieRoot>;

  beforeEach(() => {
    // Offline Yorkie document — `doc.update` mutates the root without
    // needing a real client, so the writer/reader pair round-trips in
    // process. Mirrors `docs-tree.spec.ts`.
    doc = new yorkie.Document<SlidesYorkieRoot>(
      `slides-test-${Date.now()}-${Math.random()}`,
    );
  });

  it('round-trips a SlidesDocument through writeSlidesRoot/readSlidesRoot', () => {
    const original = makeDeck();

    doc.update((root) => writeSlidesRoot(root, original));
    const result = readSlidesRoot(doc.getRoot());

    expect(result).toEqual(original);
  });

  it('replaces every top-level field on a subsequent write', () => {
    doc.update((root) => writeSlidesRoot(root, makeDeck()));
    const second: SlidesDocument = {
      ...makeDeck(),
      meta: { title: 'Replaced', themeId: 'default-light', masterId: 'default' },
      slides: [
        {
          id: 'only-slide',
          layoutId: 'title-body',
          background: { fill: { kind: 'role', role: 'background' } },
          elements: [],
          notes: [],
        },
      ],
    };

    doc.update((root) => writeSlidesRoot(root, second));
    const result = readSlidesRoot(doc.getRoot());

    expect(result.meta.title).toBe('Replaced');
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0].id).toBe('only-slide');
  });

  it('returns sensible defaults when reading an empty root', () => {
    const result = readSlidesRoot(doc.getRoot());
    expect(result.meta.title).toBe('Untitled presentation');
    expect(result.themes).toEqual([]);
    expect(result.masters).toEqual([]);
    expect(result.layouts).toEqual([]);
    expect(result.slides).toEqual([]);
  });
});
