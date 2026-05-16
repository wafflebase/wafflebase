import { describe, expect, it, vi } from 'vitest';
import type { ConnectorElement } from '../../../../src/model/connector';
import type { Element } from '../../../../src/model/element';
import type { SlidesStore } from '../../../../src/store/store';
import { dragEndpoint } from '../../../../src/view/editor/interactions/connector-endpoint-drag';

function fakeConnector(): ConnectorElement {
  return {
    id: 'c1',
    type: 'connector',
    routing: 'straight',
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 100, y: 0 },
    arrowheads: {},
    frame: { x: 0, y: 0, w: 100, h: 0, rotation: 0 },
  };
}

const rect = (id: string, x: number, y: number): Element => ({
  id,
  type: 'shape',
  frame: { x, y, w: 100, h: 100, rotation: 0 },
  data: { kind: 'rect' },
});

describe('dragEndpoint', () => {
  it('drops to free when not near any site', () => {
    const update = vi.fn();
    const store = { updateConnectorEndpoint: update } as unknown as SlidesStore;
    dragEndpoint(store, 's1', fakeConnector(), 'end', { x: 999, y: 999 }, [], 1);
    expect(update).toHaveBeenCalledWith('s1', 'c1', 'end', {
      kind: 'free',
      x: 999,
      y: 999,
    });
  });

  it('attaches when near a connection site at zoom=1', () => {
    const update = vi.fn();
    const store = { updateConnectorEndpoint: update } as unknown as SlidesStore;
    // r1 at (100, 100) → N site at (150, 100).
    const els = [rect('r1', 100, 100)];
    dragEndpoint(store, 's1', fakeConnector(), 'start', { x: 150, y: 100 }, els, 1);
    expect(update).toHaveBeenCalledWith('s1', 'c1', 'start', {
      kind: 'attached',
      elementId: 'r1',
      siteIndex: 0,
    });
  });

  it('excludes the connector itself from snap candidates', () => {
    const update = vi.fn();
    const store = { updateConnectorEndpoint: update } as unknown as SlidesStore;
    // Pretend the connector is in the elements list — it must not snap
    // to itself even though its id matches.
    const els: Element[] = [
      { id: 'c1', type: 'connector' } as unknown as Element,
    ];
    dragEndpoint(store, 's1', fakeConnector(), 'end', { x: 0, y: 0 }, els, 1);
    expect(update).toHaveBeenCalledWith('s1', 'c1', 'end', {
      kind: 'free',
      x: 0,
      y: 0,
    });
  });

  it('routes side="start" to the start endpoint, side="end" to the end', () => {
    const update = vi.fn();
    const store = { updateConnectorEndpoint: update } as unknown as SlidesStore;
    dragEndpoint(store, 's1', fakeConnector(), 'start', { x: 10, y: 20 }, [], 1);
    dragEndpoint(store, 's1', fakeConnector(), 'end', { x: 30, y: 40 }, [], 1);
    expect(update).toHaveBeenNthCalledWith(1, 's1', 'c1', 'start', {
      kind: 'free',
      x: 10,
      y: 20,
    });
    expect(update).toHaveBeenNthCalledWith(2, 's1', 'c1', 'end', {
      kind: 'free',
      x: 30,
      y: 40,
    });
  });

  // Zoom mismatch regression (slides-connectors PR1): the snap rule
  // must agree with the overlay highlight rule. Both interpret
  // SITE_SNAP_RADIUS as screen pixels, so a cursor that fails to
  // highlight a site at zoom=2 must also fail to snap to it.
  it('does not attach at zoom=2 when distance > 12 screen px', () => {
    const update = vi.fn();
    const store = { updateConnectorEndpoint: update } as unknown as SlidesStore;
    // r1 N site at (150, 100); cursor 8 logical units away. At
    // zoom=2 that's 16 screen px — outside the snap window.
    const els = [rect('r1', 100, 100)];
    dragEndpoint(store, 's1', fakeConnector(), 'end', { x: 158, y: 100 }, els, 2);
    expect(update).toHaveBeenCalledWith('s1', 'c1', 'end', {
      kind: 'free',
      x: 158,
      y: 100,
    });
  });

  it('attaches at zoom=0.5 when within the widened logical window', () => {
    const update = vi.fn();
    const store = { updateConnectorEndpoint: update } as unknown as SlidesStore;
    // r1 N site at (150, 100); cursor 20 logical units away. At
    // zoom=0.5 that's 10 screen px — inside the 12-screen-px window.
    const els = [rect('r1', 100, 100)];
    dragEndpoint(store, 's1', fakeConnector(), 'end', { x: 170, y: 100 }, els, 0.5);
    expect(update).toHaveBeenCalledWith('s1', 'c1', 'end', {
      kind: 'attached',
      elementId: 'r1',
      siteIndex: 0,
    });
  });
});
