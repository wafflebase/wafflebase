import { describe, expect, it } from 'vitest';
import { computePeerOverlays, type PeerView } from '../../../src/view/editor/peers';
import type { Frame } from '../../../src/model/element';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function frame(x: number, y: number, w: number, h: number, rotation = 0): Frame {
  return { x, y, w, h, rotation };
}

function peer(over: Partial<PeerView> & { clientID: string }): PeerView {
  return {
    color: '#ff0000',
    label: 'Ada',
    activeSlideId: 's1',
    ...over,
  };
}

/** A world-frame resolver backed by a fixed map. */
function lookup(map: Record<string, Frame>) {
  return (id: string): Frame | undefined => map[id];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computePeerOverlays', () => {
  it('renders a ring + label for a peer selecting an element on the current slide', () => {
    const out = computePeerOverlays(
      [peer({ clientID: 'c1', selectedElementIds: ['e1'] })],
      's1',
      lookup({ e1: frame(10, 20, 100, 50) }),
    );
    expect(out.rings).toEqual([{ frame: frame(10, 20, 100, 50), color: '#ff0000' }]);
    expect(out.labels).toEqual([{ x: 10, y: 20, text: 'Ada', color: '#ff0000' }]);
    expect(out.guides).toEqual([]);
  });

  it('filters out peers whose activeSlideId is not the current slide', () => {
    const out = computePeerOverlays(
      [peer({ clientID: 'c1', activeSlideId: 's2', selectedElementIds: ['e1'] })],
      's1',
      lookup({ e1: frame(0, 0, 10, 10) }),
    );
    expect(out.rings).toEqual([]);
    expect(out.labels).toEqual([]);
  });

  it('renders nothing when there is no current slide', () => {
    const out = computePeerOverlays(
      [peer({ clientID: 'c1', selectedElementIds: ['e1'] })],
      undefined,
      lookup({ e1: frame(0, 0, 10, 10) }),
    );
    expect(out.rings).toEqual([]);
  });

  it('skips selected ids that no longer resolve to a frame', () => {
    const out = computePeerOverlays(
      [peer({ clientID: 'c1', selectedElementIds: ['gone', 'e1'] })],
      's1',
      lookup({ e1: frame(5, 5, 20, 20) }),
    );
    expect(out.rings).toEqual([{ frame: frame(5, 5, 20, 20), color: '#ff0000' }]);
    // Label anchors to the first *resolved* ring.
    expect(out.labels).toEqual([{ x: 5, y: 5, text: 'Ada', color: '#ff0000' }]);
  });

  it('prefers live activeFrames over the static selection ring', () => {
    const out = computePeerOverlays(
      [
        peer({
          clientID: 'c1',
          selectedElementIds: ['e1'],
          activeFrames: [{ elementId: 'e1', x: 200, y: 200, w: 80, h: 40, rotation: 0 }],
        }),
      ],
      's1',
      // Stale store frame — must NOT be used while a live frame exists.
      lookup({ e1: frame(10, 20, 100, 50) }),
    );
    expect(out.rings).toEqual([{ frame: frame(200, 200, 80, 40), color: '#ff0000' }]);
    expect(out.labels).toEqual([{ x: 200, y: 200, text: 'Ada', color: '#ff0000' }]);
  });

  it('renders a dragging-guide line for a peer', () => {
    const out = computePeerOverlays(
      [peer({ clientID: 'c1', selectedElementIds: [], draggingGuide: { axis: 'x', position: 360 } })],
      's1',
      lookup({}),
    );
    expect(out.guides).toEqual([{ axis: 'x', position: 360, color: '#ff0000' }]);
  });

  it('handles multiple peers independently', () => {
    const out = computePeerOverlays(
      [
        peer({ clientID: 'c1', color: '#f00', label: 'Ada', selectedElementIds: ['e1'] }),
        peer({ clientID: 'c2', color: '#00f', label: 'Bob', selectedElementIds: ['e2'] }),
      ],
      's1',
      lookup({ e1: frame(0, 0, 10, 10), e2: frame(50, 50, 10, 10) }),
    );
    expect(out.rings).toEqual([
      { frame: frame(0, 0, 10, 10), color: '#f00' },
      { frame: frame(50, 50, 10, 10), color: '#00f' },
    ]);
    expect(out.labels.map((l) => l.text)).toEqual(['Ada', 'Bob']);
  });

  it('emits no label when a peer has neither frames nor resolvable selection', () => {
    const out = computePeerOverlays(
      [peer({ clientID: 'c1', selectedElementIds: ['gone'] })],
      's1',
      lookup({}),
    );
    expect(out.rings).toEqual([]);
    expect(out.labels).toEqual([]);
  });

  it('highlights a peer table cell-range and suppresses that table ring', () => {
    const rects = [frame(0, 0, 60, 20), frame(0, 20, 60, 20)];
    const out = computePeerOverlays(
      [
        peer({
          clientID: 'c1',
          // The table is element-selected AND cell-selected — the ring
          // is replaced by the cell highlights to avoid a doubled outline.
          selectedElementIds: ['t1'],
          selectedTableCells: { elementId: 't1', r0: 0, c0: 0, r1: 1, c1: 0 },
        }),
      ],
      's1',
      lookup({ t1: frame(100, 100, 60, 40) }),
      (elementId) => (elementId === 't1' ? rects : undefined),
    );
    expect(out.rings).toEqual([]);
    expect(out.cellRects).toEqual([
      { frame: rects[0], color: '#ff0000' },
      { frame: rects[1], color: '#ff0000' },
    ]);
    // Label falls back to the first cell rect when no ring anchors it.
    expect(out.labels).toEqual([{ x: 0, y: 0, text: 'Ada', color: '#ff0000' }]);
  });

  it('keeps rings for other selected elements while highlighting the cell table', () => {
    const rects = [frame(0, 0, 60, 20)];
    const out = computePeerOverlays(
      [
        peer({
          clientID: 'c1',
          selectedElementIds: ['t1', 'e2'],
          selectedTableCells: { elementId: 't1', r0: 0, c0: 0, r1: 0, c1: 0 },
        }),
      ],
      's1',
      lookup({ t1: frame(100, 100, 60, 40), e2: frame(5, 5, 10, 10) }),
      () => rects,
    );
    // t1's ring is suppressed; e2 still rings. Cell highlights come from t1.
    expect(out.rings).toEqual([{ frame: frame(5, 5, 10, 10), color: '#ff0000' }]);
    expect(out.cellRects).toEqual([{ frame: rects[0], color: '#ff0000' }]);
    // Anchor prefers the first resolved ring (e2) over the cell rect.
    expect(out.labels).toEqual([{ x: 5, y: 5, text: 'Ada', color: '#ff0000' }]);
  });

  it('omits cell highlights when no projector is supplied', () => {
    const out = computePeerOverlays(
      [
        peer({
          clientID: 'c1',
          selectedElementIds: ['t1'],
          selectedTableCells: { elementId: 't1', r0: 0, c0: 0, r1: 0, c1: 0 },
        }),
      ],
      's1',
      lookup({ t1: frame(0, 0, 10, 10) }),
    );
    expect(out.cellRects).toEqual([]);
  });
});
