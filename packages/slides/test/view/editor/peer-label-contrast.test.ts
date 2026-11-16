// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type { PeerView } from '../../../src/view/editor/peers';

/**
 * Peer name tags sit on the collaborator's peer color, and the peer
 * palettes are mostly light pastels (`#81ECEC`, `#98D8C8`, …). White
 * 11px text on those measured 1.4:1; the tag must pick its text color by
 * contrast instead.
 */
function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const overlay = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  const slideId = store.read().slides[0].id;
  let elementId = '';
  store.batch(() => {
    elementId = store.addElement(slideId, {
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    });
  });
  const editor = initialize({
    canvas,
    overlay,
    store,
    hostWidth: 960,
    hostHeight: 540,
    dpr: 1,
  });
  return { overlay, editor, slideId, elementId };
}

function peer(slideId: string, elementId: string, color: string): PeerView {
  return {
    clientID: `peer-${color}`,
    color,
    label: 'Ada',
    activeSlideId: slideId,
    selectedElementIds: [elementId],
    cursor: { x: 50, y: 50 },
  };
}

// jsdom normalises `style.color` to `rgb(...)`.
const NEAR_BLACK = 'rgb(26, 26, 26)';
const WHITE = 'rgb(255, 255, 255)';

describe('peer name tag text color', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    editor?.detach();
    editor = null;
  });

  it('uses near-black text on a light peer color', () => {
    const fx = setup();
    editor = fx.editor;
    editor.setPeers([peer(fx.slideId, fx.elementId, '#81ECEC')]);
    const label = fx.overlay.querySelector<HTMLElement>('.wfb-slides-peer-label');
    const tag = fx.overlay.querySelector<HTMLElement>(
      '.wfb-slides-peer-cursor-label',
    );
    expect(label, 'selection name tag').toBeTruthy();
    expect(tag, 'cursor name tag').toBeTruthy();
    expect(label!.style.color).toBe(NEAR_BLACK);
    expect(tag!.style.color).toBe(NEAR_BLACK);
  });

  it('keeps white text on a dark peer color', () => {
    const fx = setup();
    editor = fx.editor;
    editor.setPeers([peer(fx.slideId, fx.elementId, '#1967D2')]);
    const label = fx.overlay.querySelector<HTMLElement>('.wfb-slides-peer-label');
    const tag = fx.overlay.querySelector<HTMLElement>(
      '.wfb-slides-peer-cursor-label',
    );
    expect(label!.style.color).toBe(WHITE);
    expect(tag!.style.color).toBe(WHITE);
  });
});
