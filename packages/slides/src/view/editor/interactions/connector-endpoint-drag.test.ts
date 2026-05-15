import { describe, expect, it, vi } from 'vitest';
import type { ConnectorElement } from '../../../model/connector';
import type { Element } from '../../../model/element';
import type { SlidesStore } from '../../../store/store';
import { dragEndpoint } from './connector-endpoint-drag';

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
    dragEndpoint(store, 's1', fakeConnector(), 'end', { x: 999, y: 999 }, []);
    expect(update).toHaveBeenCalledWith('s1', 'c1', 'end', {
      kind: 'free',
      x: 999,
      y: 999,
    });
  });

  it('attaches when near a connection site', () => {
    const update = vi.fn();
    const store = { updateConnectorEndpoint: update } as unknown as SlidesStore;
    // r1 at (100, 100) → N site at (150, 100).
    const els = [rect('r1', 100, 100)];
    dragEndpoint(store, 's1', fakeConnector(), 'start', { x: 150, y: 100 }, els);
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
    dragEndpoint(store, 's1', fakeConnector(), 'end', { x: 0, y: 0 }, els);
    expect(update).toHaveBeenCalledWith('s1', 'c1', 'end', {
      kind: 'free',
      x: 0,
      y: 0,
    });
  });

  it('routes side="start" to the start endpoint, side="end" to the end', () => {
    const update = vi.fn();
    const store = { updateConnectorEndpoint: update } as unknown as SlidesStore;
    dragEndpoint(store, 's1', fakeConnector(), 'start', { x: 10, y: 20 }, []);
    dragEndpoint(store, 's1', fakeConnector(), 'end', { x: 30, y: 40 }, []);
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
});
