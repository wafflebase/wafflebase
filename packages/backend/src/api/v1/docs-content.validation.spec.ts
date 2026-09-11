import { BadRequestException } from '@nestjs/common';
import {
  assertValidDocsBody,
  assertValidSlidesBody,
} from './docs-content.controller';
import { MAX_FONT_SIZE, MAX_LINE_HEIGHT } from '@wafflebase/docs';

/**
 * The depth this file's payloads nest to. Comfortably past the ~11k frames a
 * default Node stack holds, and each level of the walk costs several frames —
 * so an uncapped walk is a `RangeError` here, not a slow one. At roughly 50
 * bytes of JSON per level it is ~1 MB, well inside the 25 MB body limit, which
 * is the point: the depth ceiling is not reachable only by an implausible
 * request.
 */
const OVERFLOW_DEPTH = 20000;

/**
 * `depth` nested table blocks, each holding the next inside its single cell.
 * The innermost entry is an ordinary paragraph so the leaf is valid and the
 * only thing under test is the nesting.
 *
 * A docs table cell and a slide text body's table cell are the same shape, so
 * one builder feeds both arms.
 */
function nestedTableBlocks(depth: number): unknown[] {
  let blocks: unknown[] = [
    { id: 'leaf', type: 'paragraph', style: {}, inlines: [] },
  ];
  for (let i = 0; i < depth; i++) {
    blocks = [
      {
        id: `b${i}`,
        type: 'table',
        style: {},
        inlines: [],
        tableData: {
          columnWidths: [1],
          rows: [{ cells: [{ style: {}, blocks }] }],
        },
      },
    ];
  }
  return blocks;
}

function deckWithTextBody(data: unknown): Record<string, unknown> {
  return {
    meta: { title: 'D', themeId: 'default-light', masterId: 'default' },
    themes: [],
    masters: [],
    layouts: [],
    slides: [
      {
        id: 's1',
        layoutId: 'l',
        background: {},
        elements: [{ id: 'e1', type: 'text', frame: {}, data }],
        notes: [],
      },
    ],
  };
}

function deckWithMasters(masters: unknown[]): Record<string, unknown> {
  return {
    meta: { title: 'D', themeId: 'default-light', masterId: 'default' },
    themes: [],
    masters,
    layouts: [],
    slides: [],
  };
}

/**
 * Both block walks in this controller recurse through table cells, and a cell
 * holds blocks of its own — so a payload nested deep enough exhausts the stack
 * from inside `PUT /content`, on an authenticated endpoint, at a body size far
 * under the 25 MB limit. Cap them at the same ceiling the element walk uses, so
 * a too-deep body is a 400 naming the path rather than a 500.
 */
describe('the block walks are bounded in depth', () => {
  it('refuses a deeply nested slide text body', () => {
    const deck = deckWithTextBody({
      blocks: nestedTableBlocks(OVERFLOW_DEPTH),
    });
    expect(() => assertValidSlidesBody(deck)).toThrow(BadRequestException);
    expect(() => assertValidSlidesBody(deck)).toThrow(/nested too deeply/);
  });

  it('refuses deeply nested slide notes', () => {
    const deck = deckWithTextBody({ blocks: [] });
    (deck.slides as Array<Record<string, unknown>>)[0].notes =
      nestedTableBlocks(OVERFLOW_DEPTH);
    expect(() => assertValidSlidesBody(deck)).toThrow(/nested too deeply/);
  });

  it('refuses a deeply nested docs body', () => {
    const body = { blocks: nestedTableBlocks(OVERFLOW_DEPTH) };
    expect(() => assertValidDocsBody(body)).toThrow(BadRequestException);
    expect(() => assertValidDocsBody(body)).toThrow(/nested too deeply/);
  });

  it('still accepts the nesting a real document reaches', () => {
    // Two levels of table-in-table is already past anything the editor or the
    // DOCX/PPTX importers produce; the ceiling must not be near it.
    const deck = deckWithTextBody({ blocks: nestedTableBlocks(2) });
    expect(() => assertValidSlidesBody(deck)).not.toThrow();
    expect(() =>
      assertValidDocsBody({ blocks: nestedTableBlocks(2) }),
    ).not.toThrow();
  });
});

/**
 * An inline image's height becomes its line's height in `measureSegments`,
 * exactly as a run's `fontSize` does — and the write band covered only the
 * font size, so a `PUT` could store a 1e9-pixel image that every reader then
 * has to drop. Banded on write, dropping rather than clamping because that is
 * what the readers do with a pair they cannot paint.
 */
describe('assertValidSlidesBody bands an inline image size', () => {
  function firstInlineStyle(
    deck: Record<string, unknown>,
  ): Record<string, unknown> {
    const slides = deck.slides as Array<Record<string, unknown>>;
    const element = (slides[0].elements as Array<Record<string, unknown>>)[0];
    const body = element.data as Record<string, unknown>;
    const block = (body.blocks as Array<Record<string, unknown>>)[0];
    const inline = (block.inlines as Array<Record<string, unknown>>)[0];
    return inline.style as Record<string, unknown>;
  }

  function deckWithImage(image: unknown): Record<string, unknown> {
    return deckWithTextBody({
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          style: {},
          inlines: [{ text: 'x', style: { image } }],
        },
      ],
    });
  }

  it('drops an out-of-band image rather than storing it', () => {
    const deck = deckWithImage({ src: 'a', width: 1e9, height: 1e9 });
    assertValidSlidesBody(deck);
    expect(firstInlineStyle(deck).image).toBeUndefined();
  });

  it('drops an image whose size is not a number at all', () => {
    const deck = deckWithImage({ src: 'a', width: '100', height: 20 });
    assertValidSlidesBody(deck);
    expect(firstInlineStyle(deck).image).toBeUndefined();
  });

  it('keeps a paintable image untouched', () => {
    const deck = deckWithImage({ src: 'a', width: 100, height: 20 });
    assertValidSlidesBody(deck);
    expect(firstInlineStyle(deck).image).toEqual({
      src: 'a',
      width: 100,
      height: 20,
    });
  });
});

/**
 * A wrong-*typed* value is the caller's content, so it is refused with a 400
 * naming the field rather than deleted behind their back — the rule every other
 * numeric in this file already follows (`assertValidBlockStyle`). Only a number
 * out of band is repaired.
 */
describe('assertValidSlidesBody refuses a wrong-typed inline fontSize', () => {
  function deckWithFontSize(fontSize: unknown): Record<string, unknown> {
    return deckWithTextBody({
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          style: {},
          inlines: [{ text: 'x', style: { fontSize } }],
        },
      ],
    });
  }

  it('rejects a string fontSize instead of dropping it', () => {
    expect(() => assertValidSlidesBody(deckWithFontSize('24'))).toThrow(
      /'style\.fontSize'/,
    );
  });

  it('treats null as absent, the way every other field here does', () => {
    const deck = deckWithFontSize(null);
    expect(() => assertValidSlidesBody(deck)).not.toThrow();
  });
});

/**
 * `Master.placeholderStyles` carries a `fontSize` and a `lineHeight`, and
 * `seedPlaceholderBlocks` copies both verbatim into a docs `Block` — so they
 * reach the same layout engine the block walk exists to band, through a
 * collection the walk never visited.
 */
describe('assertValidSlidesBody bands master placeholder typography', () => {
  function firstStyle(deck: Record<string, unknown>): Record<string, unknown> {
    const master = (deck.masters as Array<Record<string, unknown>>)[0];
    const styles = master.placeholderStyles as Record<string, unknown>;
    return styles.title as Record<string, unknown>;
  }

  it('clamps an out-of-band fontSize and lineHeight', () => {
    const deck = deckWithMasters([
      {
        id: 'm1',
        themeId: 't',
        background: {},
        placeholderStyles: {
          title: { fontRole: 'heading', fontSize: 1e9, lineHeight: 1e9 },
        },
      },
    ]);
    assertValidSlidesBody(deck);
    expect(firstStyle(deck).fontSize).toBe(MAX_FONT_SIZE);
    expect(firstStyle(deck).lineHeight).toBe(MAX_LINE_HEIGHT);
  });

  it('rejects a wrong-typed fontSize', () => {
    const deck = deckWithMasters([
      {
        id: 'm1',
        themeId: 't',
        background: {},
        placeholderStyles: { body: { fontSize: '44' } },
      },
    ]);
    expect(() => assertValidSlidesBody(deck)).toThrow(
      /masters\[0\]\.placeholderStyles\.body.*'fontSize'/,
    );
  });

  it('leaves a master without placeholder styles alone', () => {
    const deck = deckWithMasters([{ id: 'm1', themeId: 't', background: {} }]);
    expect(() => assertValidSlidesBody(deck)).not.toThrow();
  });
});
