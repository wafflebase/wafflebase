import { describe, it, expect } from 'vitest';
import { mapMiroItems } from './map-items';

const at = (x: number, y: number, w = 100, h = 100) => ({
  position: { x, y },
  geometry: { width: w, height: h },
});

/** Default resolver for cases that are not about image URLs. */
const identity = (url: string) => url;

describe('mapMiroItems', () => {
  it('maps a sticky note to a roundRect shape with fill and text', () => {
    const { inits } = mapMiroItems({
      items: [{ id: 's1', type: 'sticky_note', ...at(0, 0), data: { content: '<p>Hi</p>' }, style: { fillColor: 'green' } }],
      connectors: [],
      resolveImageUrl: identity,
    });
    expect(inits).toHaveLength(1);
    const data = (inits[0] as any).data as Record<string, any>;
    expect(inits[0].type).toBe('shape');
    expect(data.kind).toBe('roundRect');
    expect(data.fill).toMatchObject({ kind: 'srgb' });
    expect(data.text.verticalAnchor).toBe('middle');
    expect(data.text.blocks[0].inlines.map((i: any) => i.text).join('')).toBe('Hi');
  });

  it('maps a shape with its kind, hex fill and border', () => {
    const { inits } = mapMiroItems({
      items: [{
        id: 'sh1', type: 'shape', ...at(10, 10, 40, 20),
        data: { shape: 'circle', content: 'Round' },
        style: { fillColor: '#ff9d48', borderColor: '#1a1a1a', borderWidth: 3 },
      }],
      connectors: [],
      resolveImageUrl: identity,
    });
    const data = (inits[0] as any).data as Record<string, any>;
    expect(data.kind).toBe('ellipse');
    expect(data.fill).toEqual({ kind: 'srgb', value: '#ff9d48' });
    expect(data.stroke).toMatchObject({ width: 3 });
    expect(inits[0].frame).toMatchObject({ x: -10, y: 0, w: 40, h: 20 });
  });

  it('maps a text item to a text element', () => {
    const { inits } = mapMiroItems({
      items: [{ id: 't1', type: 'text', ...at(0, 0), data: { content: '<p>Words</p>' } }],
      connectors: [],
      resolveImageUrl: identity,
    });
    expect(inits[0].type).toBe('text');
    expect(((inits[0] as any).data).blocks[0].inlines.map((i: any) => i.text).join('')).toBe('Words');
  });

  it('maps an image item to an image element through the injected resolver', () => {
    // The backend's `imageUrl` is ROOT-RELATIVE and the API is on a different
    // origin, so it must not reach the document unresolved. The resolver is
    // injected rather than defaulted precisely so this cannot be forgotten.
    const { inits } = mapMiroItems({
      items: [{ id: 'i1', type: 'image', ...at(0, 0), data: { imageUrl: '/api/v1/workspaces/w/images/x' } }],
      connectors: [],
      resolveImageUrl: (url) => `https://api.example.test${url}`,
    });
    expect(inits[0].type).toBe('image');
    expect(((inits[0] as any).data).src).toBe('https://api.example.test/api/v1/workspaces/w/images/x');
  });

  it('maps a frame to a labelled rectangle and a card to a roundRect', () => {
    const { inits } = mapMiroItems({
      items: [
        { id: 'f1', type: 'frame', ...at(0, 0), data: { title: 'Sprint' } },
        { id: 'c1', type: 'card', ...at(0, 0), data: { title: 'Task', description: 'Do it' } },
      ],
      connectors: [],
      resolveImageUrl: identity,
    });
    const frame = (inits[0] as any).data;
    const card = (inits[1] as any).data;
    expect(frame.kind).toBe('rect');
    expect(frame.text.blocks[0].inlines.map((i: any) => i.text).join('')).toBe('Sprint');
    expect(card.kind).toBe('roundRect');
    const cardText = card.text.blocks.map((b: any) => b.inlines.map((i: any) => i.text).join('')).join(' ');
    expect(cardText).toContain('Task');
    expect(cardText).toContain('Do it');
  });

  it('attaches connector endpoints to the mapped elements via the id map', () => {
    const { inits } = mapMiroItems({
      items: [
        { id: 'a', type: 'shape', ...at(0, 0), data: { shape: 'rectangle' } },
        { id: 'b', type: 'shape', ...at(300, 0), data: { shape: 'rectangle' } },
      ],
      connectors: [{ id: 'c1', shape: 'elbowed', startItem: { id: 'a' }, endItem: { id: 'b' }, style: { endStrokeCap: 'arrow' } }],
      resolveImageUrl: identity,
    });

    const connector = inits.find((i) => i.type === 'connector') as any;
    expect(connector).toBeTruthy();
    expect(connector.routing).toBe('elbow');
    expect(connector.start.kind).toBe('attached');
    expect(connector.end.kind).toBe('attached');
    // The attached ids must be the NEW element ids, not the Miro ids.
    const shapeIds = inits.filter((i) => i.type === 'shape').map((i: any) => i.__id);
    expect(shapeIds).toContain(connector.start.elementId);
    expect(shapeIds).toContain(connector.end.elementId);
    expect(connector.arrowheads.end).toBeTruthy();
  });

  it('skips a connector when only the end is unmapped, and counts it', () => {
    // Miro exposes no absolute coordinate for the unmapped end, so there is no
    // honest fallback position — a `free` endpoint would strand the line at the
    // world origin, far from a board that sits away from (0, 0). Report it.
    const { inits, skipped } = mapMiroItems({
      items: [{ id: 'a', type: 'shape', ...at(0, 0), data: { shape: 'rectangle' } }],
      connectors: [{ id: 'c1', startItem: { id: 'a' }, endItem: { id: 'ghost' } }],
      resolveImageUrl: identity,
    });
    expect(inits.find((i) => i.type === 'connector')).toBeUndefined();
    expect(skipped.connector).toBe(1);
  });

  it('skips a connector when only the start is unmapped, and counts it', () => {
    const { inits, skipped } = mapMiroItems({
      items: [{ id: 'b', type: 'shape', ...at(0, 0), data: { shape: 'rectangle' } }],
      connectors: [{ id: 'c1', startItem: { id: 'ghost' }, endItem: { id: 'b' } }],
      resolveImageUrl: identity,
    });
    expect(inits.find((i) => i.type === 'connector')).toBeUndefined();
    expect(skipped.connector).toBe(1);
  });

  it('never emits a free endpoint — every emitted connector end is attached', () => {
    const { inits } = mapMiroItems({
      items: [
        { id: 'a', type: 'shape', ...at(9000, 9000), data: { shape: 'rectangle' } },
        { id: 'b', type: 'shape', ...at(9300, 9000), data: { shape: 'rectangle' } },
      ],
      connectors: [
        { id: 'c1', startItem: { id: 'a' }, endItem: { id: 'b' } },
        { id: 'c2', startItem: { id: 'a' }, endItem: { id: 'ghost' } },
      ],
      resolveImageUrl: identity,
    });
    const connectors = inits.filter((i) => i.type === 'connector') as any[];
    expect(connectors).toHaveLength(1);
    for (const c of connectors) {
      expect(c.start.kind).toBe('attached');
      expect(c.end.kind).toBe('attached');
    }
  });

  it('skips a connector whose ends are both unmapped, and counts it', () => {
    const { inits, skipped } = mapMiroItems({
      items: [],
      connectors: [{ id: 'c1', startItem: { id: 'x' }, endItem: { id: 'y' } }],
      resolveImageUrl: identity,
    });
    expect(inits).toHaveLength(0);
    expect(skipped.connector).toBe(1);
  });

  it('reports an unknown shape kind as an approximation, not a skip', () => {
    // The shape IS imported, as a rect. Counting it under `skipped` produced
    // "2 shape-kinds skipped" — claiming content was lost when it was present,
    // and naming a Miro item type that does not exist.
    const { inits, skipped, approximated } = mapMiroItems({
      items: [
        { id: 'sh1', type: 'shape', ...at(0, 0), data: { shape: 'some_future_shape' } },
        { id: 'sh2', type: 'shape', ...at(0, 0), data: { shape: 'another_new_one' } },
      ],
      connectors: [],
      resolveImageUrl: identity,
    });

    expect(inits).toHaveLength(2);
    expect(inits.every((i) => (i as any).data.kind === 'rect')).toBe(true);
    expect(skipped).toEqual({});
    expect(approximated).toEqual({ 'shape-kind': 2 });
  });

  it('escapes card text before wrapping it in HTML', () => {
    // Title/description arrive as PLAIN TEXT. Interpolated raw, `</p><p>` and
    // `<` restructure the content or swallow words into a tag name.
    const { inits } = mapMiroItems({
      items: [{
        id: 'c1', type: 'card', ...at(0, 0),
        data: { title: 'a < b & c', description: 'x</p><p>y' },
      }],
      connectors: [],
      resolveImageUrl: identity,
    });

    const blocks = (inits[0] as any).data.text.blocks as any[];
    const lines = blocks.map((b) => b.inlines.map((i: any) => i.text).join(''));
    expect(lines[0]).toBe('a < b & c');
    // One paragraph per field — the injected `</p><p>` must not split it.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('x</p><p>y');
  });

  it('emits frames before the other elements so they sit behind them', () => {
    // A frame becomes an opaque rectangle and z-order is array order, so a
    // frame arriving after its contents painted straight over them.
    const { inits } = mapMiroItems({
      items: [
        { id: 's1', type: 'sticky_note', ...at(0, 0), data: { content: 'note' } },
        { id: 'f1', type: 'frame', ...at(0, 0, 500, 500), data: { title: 'Sprint' } },
        { id: 's2', type: 'sticky_note', ...at(50, 50), data: { content: 'other' } },
      ],
      connectors: [],
      resolveImageUrl: identity,
    });

    const frameText = (inits[0] as any).data.text.blocks[0].inlines
      .map((i: any) => i.text).join('');
    expect(frameText).toBe('Sprint');
    expect(inits).toHaveLength(3);
  });

  it('skips unsupported item types and counts them by type', () => {
    const { inits, skipped } = mapMiroItems({
      items: [
        { id: 'd1', type: 'document', ...at(0, 0) },
        { id: 'e1', type: 'embed', ...at(0, 0) },
        { id: 'e2', type: 'embed', ...at(0, 0) },
      ],
      connectors: [],
      resolveImageUrl: identity,
    });
    expect(inits).toHaveLength(0);
    expect(skipped).toEqual({ document: 1, embed: 2 });
  });
});
