// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { importPptx } from '../../../src/import/pptx/index.js';
import { exportPptx } from '../../../src/export/pptx/index.js';
import { connectorToXml } from '../../../src/export/pptx/connector.js';
import { connectorExportFrame } from '../../../src/export/pptx/connector-frame.js';
import { buildMinimalPptx } from '../../import/pptx/__fixtures__/build-minimal-pptx.js';
import type { ConnectorElement } from '../../../src/model/connector.js';

/**
 * A connector drawn right-to-left / bottom-to-top keeps its direction through
 * PPTX: the exporter writes `flipH` / `flipV`, which the importer reads back
 * into the same start/end corners.
 */

const connector = (
  start: { x: number; y: number },
  end: { x: number; y: number },
): ConnectorElement => ({
  id: 'c',
  type: 'connector',
  frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
  routing: 'straight',
  start: { kind: 'free', ...start },
  end: { kind: 'free', ...end },
  arrowheads: { end: { kind: 'triangle', size: 'md' } },
  stroke: { color: '#000000', width: 2 },
});

async function roundTrip(el: ConnectorElement): Promise<ConnectorElement> {
  const a = (await importPptx(await buildMinimalPptx())).document;
  const deck = { ...a, slides: [{ ...a.slides[0], elements: [el] }] };
  const bytes = await exportPptx(deck);
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const b = (await importPptx(buf)).document;
  const out = b.slides[0].elements.find((e) => e.type === 'connector');
  expect(out).toBeDefined();
  return out as ConnectorElement;
}

describe('connector direction in PPTX', () => {
  it('flags flips only when start is right of / below end', () => {
    const empty = new Map();
    expect(
      connectorExportFrame(connector({ x: 0, y: 0 }, { x: 100, y: 50 }), empty),
    ).not.toHaveProperty('flipH');
    const back = connectorExportFrame(
      connector({ x: 500, y: 300 }, { x: 100, y: 300 }),
      empty,
    );
    expect(back.flipH).toBe(true);
    expect(back).not.toHaveProperty('flipV');
    const xml = connectorToXml(connector({ x: 0, y: 0 }, { x: 1, y: 1 }), {
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      rotation: 0,
      flipH: true,
      flipV: true,
    });
    expect(xml).toContain('<a:xfrm flipH="1" flipV="1">');
  });

  it.each([
    ['left-to-right (stays level)', { x: 300, y: 400 }, { x: 900, y: 400 }],
    ['right-to-left', { x: 900, y: 400 }, { x: 300, y: 400 }],
    ['bottom-to-top', { x: 600, y: 800 }, { x: 600, y: 200 }],
    ['up-and-left diagonal', { x: 900, y: 800 }, { x: 300, y: 200 }],
    ['down-and-left diagonal', { x: 900, y: 200 }, { x: 300, y: 800 }],
  ])('%s keeps its start and end', async (_name, start, end) => {
    const out = await roundTrip(connector(start, end));
    expect(out.start.kind).toBe('free');
    expect(out.end.kind).toBe('free');
    if (out.start.kind !== 'free' || out.end.kind !== 'free') return;
    expect(out.start.x).toBeCloseTo(start.x, 0);
    expect(out.start.y).toBeCloseTo(start.y, 0);
    expect(out.end.x).toBeCloseTo(end.x, 0);
    expect(out.end.y).toBeCloseTo(end.y, 0);
    expect(out.arrowheads.end?.kind).toBe('triangle');
  });
});
