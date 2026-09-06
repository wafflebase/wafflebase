import { describe, it, expect } from 'vitest';
import { mapMiroItems } from './map-items';
import type { MiroItemLike } from './types';

/**
 * Items and connectors copied VERBATIM out of a `GET /v2/boards/{id}/items`
 * and `/connectors` response, keys and value types untouched.
 *
 * The rest of this package's fixtures are hand-written, and that is precisely
 * how a whole class of defects survived: they tidied the payload into the
 * shape the mapper expected. `borderWidth: 3` where Miro sends `"2.0"`, a
 * `geometry.height` on a text item that never has one, a `fillColor` with no
 * `fillOpacity` beside it. Every one of those differences was a real bug, and
 * none of them could fail a test written from the same assumption as the code.
 *
 * So this file asserts against reality instead. Nothing here should be
 * "cleaned up" — the awkward parts (numbers as strings, `&amp;` in a frame
 * title, an item with no `data` at all) are the point.
 */

/** A shape: note every `style` number is a STRING, and it is transparent. */
const SHAPE: MiroItemLike = {
  id: '3458764545166854491',
  type: 'shape',
  data: { content: '<p>Hello</p>', shape: 'rectangle' },
  style: {
    fillColor: '#ffffff',
    fillOpacity: '0.0',
    fontFamily: 'open_sans',
    fontSize: '21',
    borderColor: '#1a1a1a',
    borderWidth: '2.0',
    borderOpacity: '1.0',
    borderStyle: 'normal',
    textAlign: 'center',
    textAlignVertical: 'middle',
    color: '#1a1a1a',
  },
  geometry: { width: 1452.24280948272, height: 1543.41745401363 },
  position: {
    x: 22524.354405686154,
    y: -3744.7238010658143,
    relativeTo: 'canvas_center',
  },
};

/** A text item: `geometry` carries a width and NO height. */
const TEXT: MiroItemLike = {
  id: '3458764545166854546',
  type: 'text',
  data: { content: '<p>CodeMirror</p>' },
  style: {
    fillColor: '#ffffff',
    fillOpacity: '0.0',
    fontFamily: 'open_sans',
    fontSize: '14',
    textAlign: 'center',
    color: '#1a1a1a',
  },
  geometry: { width: 77 },
  position: {
    x: 94.14273527118573,
    y: 91.76677942211455,
    relativeTo: 'parent_top_left',
  },
  parent: { id: 'frame-1' },
};

/** A frame. Miro delivers the title ALREADY HTML-escaped. */
const FRAME: MiroItemLike = {
  id: 'frame-1',
  type: 'frame',
  data: {
    format: 'custom',
    showContent: true,
    title: 'Creating Document &amp; Auth Webhook',
    type: 'unknown',
  },
  geometry: { width: 1000, height: 800 },
  position: { x: 0, y: 0, relativeTo: 'canvas_center' },
};

/** An item Miro itself flags unsupported: no `data`, no `style`. */
const UNSUPPORTED_SHAPE: MiroItemLike = {
  id: '3458764545166884238',
  type: 'shape',
  geometry: { width: 120, height: 120 },
  position: { x: 87, y: 517, relativeTo: 'parent_top_left' },
  parent: { id: 'frame-1' },
};

const CONNECTOR = {
  id: '3458764545166854549',
  type: 'connector',
  startItem: {
    id: '3458764545166854491',
    position: { x: '100%', y: '50%' },
  },
  endItem: { id: '3458764545166854546', position: { x: '0%', y: '50%' } },
  shape: 'curved',
  style: {
    startStrokeCap: 'none',
    endStrokeCap: 'rounded_stealth',
    strokeWidth: '1.0',
    strokeStyle: 'normal',
    strokeColor: '#000000',
  },
  captions: [
    { content: '<p>(1) create doc with name</p>', position: '49.5%' },
  ],
};

describe('mapMiroItems on verbatim Miro API payload', () => {
  const { inits, skipped, approximated } = mapMiroItems({
    items: [SHAPE, TEXT, FRAME, UNSUPPORTED_SHAPE],
    connectors: [CONNECTOR],
    resolveImageUrl: (url) => url,
  });
  /** The concatenated text of an element, whatever kind of body it carries. */
  const textOf = (init: unknown): string => {
    const data = (init as { data?: any }).data ?? {};
    const blocks = data.blocks ?? data.text?.blocks ?? [];
    return blocks
      .flatMap((b: any) => b.inlines ?? [])
      .map((i: any) => i.text)
      .join('');
  };
  /** Elements are selected by their CONTENT — several share a `kind`. */
  const byText = (needle: string): any =>
    inits.find((i) => textOf(i).includes(needle));

  const shape = byText('Hello');
  const text = byText('CodeMirror');
  const connector = inits.find((i) => i.type === 'connector') as never as Record<string, any>;

  it('keeps the border, which the string-typed width used to discard', () => {
    expect(shape.data.stroke).toEqual({
      color: { kind: 'srgb', value: '#1a1a1a' },
      width: 2,
    });
  });

  it('leaves a transparent shape unpainted rather than opaque white', () => {
    expect(shape.data.fill).toBeUndefined();
  });

  it('carries the shape label at the size and colour Miro gave it', () => {
    const inline = shape.data.text.blocks[0].inlines[0];
    // 21 CSS px is 15.75pt, which `ptToPx` renders back at 21px.
    expect(inline.style).toMatchObject({ fontSize: 15.75, color: '#1a1a1a' });
    expect(shape.data.text.blocks[0].style.alignment).toBe('center');
    expect(shape.data.text.verticalAnchor).toBe('middle');
  });

  it('sizes the height-less text item about the centre Miro gave it', () => {
    // Frame-relative: the frame's own top-left is (-500, -400).
    const centreY = -400 + 91.76677942211455;
    expect(text.frame.h).toBe(21);
    expect(text.frame.y + text.frame.h / 2).toBeCloseTo(centreY, 10);
  });

  it('gives the connector its Miro colour, width and arrowhead', () => {
    expect(connector.stroke).toEqual({
      color: { kind: 'srgb', value: '#000000' },
      width: 1,
    });
    expect(connector.arrowheads).toEqual({ end: { kind: 'triangle', size: 'md' } });
    expect(connector.routing).toBe('curved');
  });

  it('keeps the connector caption as a placed label', () => {
    const label = byText('(1) create doc with name');
    expect(label).toBeDefined();
    expect(label.type).toBe('text');
    expect(approximated['connector-caption']).toBe(1);
  });

  // Miro escapes the title before sending it, so routing it through the HTML
  // parser is what DECODES it. Escaping it again — the obvious-looking fix, and
  // the one the card branch legitimately needs for its plain-text fields —
  // would render the entity as literal '&amp;'.
  it('decodes a frame title, which Miro delivers already escaped', () => {
    expect(textOf(byText('Creating Document'))).toBe('Creating Document & Auth Webhook');
  });

  it('imports an item with no data at all, reporting the degradation', () => {
    // Miro sends `isSupported: false` shapes with no `data.shape`. They are
    // still real boxes on the board, so they come across as rectangles.
    expect(approximated['shape-kind']).toBe(1);
    expect(skipped).toEqual({});
  });
});
