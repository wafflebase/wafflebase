import { describe, expect, it, vi } from 'vitest';
import { createSession, createStore, memoryBlobs, memoryMeta } from '../index';
import type { Capture, Target } from '../index';
import { captureAtPoint, captureRegion, forgetEvictedCaptures } from './capture-item';

const store = () => createStore({ blobs: memoryBlobs(), meta: memoryMeta() });

const pixels = (id = 'x') => ({
  dataUrl: `data:image/jpeg;base64,${'A'.repeat(64)}`,
  w: 10,
  h: 10,
  layers: 2,
  mime: 'image/jpeg',
  coverage: 1,
  id,
});

describe('captureAtPoint', () => {
  it('does NOT photograph a DOM target', async () => {
    // A control's box routinely overlaps an editor canvas, and capturing there
    // paints whatever share of the canvas lies under it — an image with no
    // button in the frame. The selector, box and text are the description.
    const capturePixels = vi.fn(() => pixels());
    const domTarget: Target = {
      kind: 'dom',
      selector: 'div > button',
      tag: 'button',
      text: 'Filter',
      rect: { x: 0, y: 0, w: 80, h: 30 },
    };
    const report = await captureAtPoint(
      { x: 1, y: 1 },
      { store: store(), capturePixels, locate: () => domTarget },
    );
    expect(report.target).toBe(domTarget);
    expect(report.capture).toBeUndefined();
    expect(capturePixels).not.toHaveBeenCalled();
  });

  it('photographs a canvas target', async () => {
    const capturePixels = vi.fn(() => pixels());
    const report = await captureAtPoint(
      { x: 1, y: 1 },
      {
        store: store(),
        capturePixels,
        locate: () => ({
          kind: 'canvas',
          surface: 'sheet',
          address: 'Sheet1!C7',
          rect: { x: 0, y: 0, w: 80, h: 21 },
        }),
      },
    );
    expect(capturePixels).toHaveBeenCalledOnce();
    expect(report.capture?.layers).toBe(2);
  });

  it('inventories a region that has no pixels', async () => {
    const report = await captureRegion(
      { x: 0, y: 0, w: 100, h: 100 },
      {
        store: store(),
        capturePixels: () => undefined,
        inventory: () => [
          { selector: 'button', tag: 'button', text: 'Sign in', rect: { x: 0, y: 0, w: 10, h: 10 } },
        ],
      },
    );
    expect(report.target.kind === 'viewport' && report.target.elements).toHaveLength(1);
  });
});

describe('forgetEvictedCaptures', () => {
  const capture = (id: string): Capture => ({
    id,
    w: 10,
    h: 10,
    bytes: 100,
    layers: 1,
    mime: 'image/jpeg',
  });

  it('un-claims the images the budget deleted, and names the notes', () => {
    // Nothing was clearing this, so `items()` — read by the badge, the panel and
    // the bundle — went on claiming images that were gone.
    const session = createSession({ newId: () => `i${session.count() + 1}` });
    const first = session.add({
      note: 'the merged border looks broken',
      target: { kind: 'viewport', rect: { x: 0, y: 0, w: 1, h: 1 } },
      capture: capture('cap-1'),
    });
    session.add({
      note: 'kept',
      target: { kind: 'viewport', rect: { x: 0, y: 0, w: 1, h: 1 } },
      capture: capture('cap-2'),
    });

    const affected = forgetEvictedCaptures(session, ['cap-1']);
    expect(affected).toEqual(['the merged border looks broken']);
    expect(session.items().find((i) => i.id === first.id)?.capture).toBeUndefined();
    expect(session.items().find((i) => i.note === 'kept')?.capture?.id).toBe('cap-2');
  });

  it('is a no-op with nothing evicted', () => {
    const session = createSession();
    expect(forgetEvictedCaptures(session, [])).toEqual([]);
  });
});
