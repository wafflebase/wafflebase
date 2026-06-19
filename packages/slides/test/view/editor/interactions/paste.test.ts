import { describe, it, expect } from 'vitest';
import type { Element } from '../../../../src/model/element';
import type { ConnectorElement } from '../../../../src/model/connector';
import { MemSlidesStore } from '../../../../src/store/memory';
import { pasteElements } from '../../../../src/view/editor/interactions/paste';

const rect = (id: string, x: number, y: number): Element => ({
  id,
  type: 'shape',
  frame: { x, y, w: 100, h: 100, rotation: 0 },
  data: { kind: 'rect' },
});

const connector = (
  id: string,
  startId: string,
  endId: string,
): ConnectorElement => ({
  id,
  type: 'connector',
  frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
  routing: 'straight',
  start: { kind: 'attached', elementId: startId, siteIndex: 1 },
  end: { kind: 'attached', elementId: endId, siteIndex: 3 },
  arrowheads: { end: { kind: 'triangle', size: 'md' } },
});

function setup() {
  const store = new MemSlidesStore();
  let slideId = '';
  store.batch(() => {
    slideId = store.addSlide('blank');
  });
  return { store, slideId };
}

describe('pasteElements — connector endpoint remap', () => {
  it('remaps attached endpoints to the pasted shapes, not the originals', () => {
    const { store, slideId } = setup();
    const sources: Element[] = [
      rect('a', 0, 0),
      rect('b', 300, 0),
      connector('c', 'a', 'b'),
    ];

    let newIds: string[] = [];
    store.batch(() => {
      newIds = pasteElements(store, slideId, sources, 10, 10);
    });

    const elements = store.read().slides[0].elements;
    // The originals were never added here, so the slide holds only the 3 pastes.
    expect(elements).toHaveLength(3);

    const [newA, newB, newC] = newIds;
    const pasted = elements.find((e) => e.id === newC) as ConnectorElement;
    expect(pasted.start).toMatchObject({ kind: 'attached', elementId: newA, siteIndex: 1 });
    expect(pasted.end).toMatchObject({ kind: 'attached', elementId: newB, siteIndex: 3 });
    // Crucially, the pasted connector does NOT point at the source ids.
    expect((pasted.start as { elementId: string }).elementId).not.toBe('a');
    expect((pasted.end as { elementId: string }).elementId).not.toBe('b');
  });

  it('leaves endpoints pointing outside the pasted set untouched', () => {
    const { store, slideId } = setup();
    // Only the connector + its start shape are pasted; the end shape 'b'
    // is not in the source set.
    const sources: Element[] = [rect('a', 0, 0), connector('c', 'a', 'b')];

    let newIds: string[] = [];
    store.batch(() => {
      newIds = pasteElements(store, slideId, sources, 10, 10);
    });

    const [newA, newC] = newIds;
    const pasted = store
      .read()
      .slides[0].elements.find((e) => e.id === newC) as ConnectorElement;
    expect(pasted.start).toMatchObject({ kind: 'attached', elementId: newA });
    // 'b' was not pasted → endpoint preserved as-is.
    expect(pasted.end).toMatchObject({ kind: 'attached', elementId: 'b' });
  });

  it('offsets non-connector frames and free connector endpoints by (dx, dy)', () => {
    const { store, slideId } = setup();
    const freeConnector: ConnectorElement = {
      id: 'c',
      type: 'connector',
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      routing: 'straight',
      start: { kind: 'free', x: 10, y: 10 },
      end: { kind: 'free', x: 50, y: 50 },
      arrowheads: {},
    };
    const sources: Element[] = [rect('a', 0, 0), freeConnector];

    let newIds: string[] = [];
    store.batch(() => {
      newIds = pasteElements(store, slideId, sources, 10, 10);
    });

    const elements = store.read().slides[0].elements;
    const pastedRect = elements.find((e) => e.id === newIds[0])!;
    expect(pastedRect.frame.x).toBe(10);
    expect(pastedRect.frame.y).toBe(10);

    // Free connector endpoints carry their own coords; they must be offset
    // too (the connector frame is derived from them on insert).
    const pastedConnector = elements.find((e) => e.id === newIds[1]) as ConnectorElement;
    expect(pastedConnector.start).toMatchObject({ kind: 'free', x: 20, y: 20 });
    expect(pastedConnector.end).toMatchObject({ kind: 'free', x: 60, y: 60 });
  });
});
