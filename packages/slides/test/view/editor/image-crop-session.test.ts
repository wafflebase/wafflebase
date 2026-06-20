// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type { ImageElement } from '../../../src/model/element';

function setup() {
  document.body.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  return { canvas, overlay, store };
}

function addImage(
  store: MemSlidesStore,
  slideId: string,
  frame: { x: number; y: number; w: number; h: number; rotation?: number },
): string {
  let id = '';
  store.batch(() => {
    id = store.addElement(slideId, {
      type: 'image',
      frame: { ...frame, rotation: frame.rotation ?? 0 },
      data: { src: 'data:image/png;base64,AAAA' },
    });
  });
  return id;
}

function image(store: MemSlidesStore, slideId: string, id: string): ImageElement {
  const slide = store.read().slides.find((s) => s.id === slideId)!;
  return slide.elements.find((e) => e.id === id) as ImageElement;
}

/** Center of an overlay handle in client coords (jsdom rect is 0,0). */
function handleCenter(overlay: HTMLDivElement, kind: string) {
  const el = overlay.querySelector<HTMLElement>(`[data-handle="${kind}"]`)!;
  const left = parseFloat(el.style.left);
  const top = parseFloat(el.style.top);
  const w = parseFloat(el.style.width);
  const h = parseFloat(el.style.height);
  return { x: left + w / 2, y: top + h / 2 };
}

function drag(
  overlay: HTMLDivElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  overlay.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX: from.x, clientY: from.y, button: 0, bubbles: true,
    }),
  );
  document.dispatchEvent(
    new PointerEvent('pointermove', { clientX: to.x, clientY: to.y, bubbles: true }),
  );
  document.dispatchEvent(
    new PointerEvent('pointerup', { clientX: to.x, clientY: to.y, bubbles: true }),
  );
}

function key(name: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
}

describe('image crop session', () => {
  let editor: SlidesEditor | null = null;
  afterEach(() => {
    if (editor) { editor.detach(); editor = null; }
  });

  function makeEditor(store: MemSlidesStore, canvas: HTMLCanvasElement, overlay: HTMLDivElement) {
    return initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: () => { throw new Error('not used'); },
    });
  }

  it('enters crop via API and renders black handles', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('blank'); });
    const id = addImage(store, sid, { x: 200, y: 200, w: 400, h: 300 });
    editor = makeEditor(store, canvas, overlay);

    editor.enterImageCrop(id);
    expect(editor.isCropping()).toBe(true);
    expect(overlay.querySelectorAll('[data-handle]').length).toBe(8);
    expect(overlay.querySelector('.wfb-slides-crop-handle')).not.toBeNull();
  });

  it('trims from the east handle and commits crop + frame on Enter', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('blank'); });
    const id = addImage(store, sid, { x: 200, y: 200, w: 400, h: 300 });
    editor = makeEditor(store, canvas, overlay);

    editor.enterImageCrop(id);
    const e = handleCenter(overlay, 'e'); // (600, 350)
    drag(overlay, e, { x: e.x - 100, y: e.y }); // pull the east edge in 100px
    key('Enter');

    expect(editor.isCropping()).toBe(false);
    const img = image(store, sid, id);
    expect(img.frame.w).toBeCloseTo(300);
    expect(img.frame.x).toBeCloseTo(200);
    expect(img.data.crop).toBeDefined();
    expect(img.data.crop!.w).toBeCloseTo(0.75);
    expect(img.data.crop!.h).toBeCloseTo(1);
  });

  it('discards changes on Escape', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('blank'); });
    const id = addImage(store, sid, { x: 200, y: 200, w: 400, h: 300 });
    editor = makeEditor(store, canvas, overlay);

    editor.enterImageCrop(id);
    const e = handleCenter(overlay, 'e');
    drag(overlay, e, { x: e.x - 100, y: e.y });
    key('Escape');

    expect(editor.isCropping()).toBe(false);
    const img = image(store, sid, id);
    expect(img.frame.w).toBeCloseTo(400); // unchanged
    expect(img.data.crop).toBeUndefined();
  });

  it('crops a rotated image in its own local frame', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('blank'); });
    // 90° rotation: centre (400,350), cos=0, sin=1.
    const id = addImage(store, sid, {
      x: 200, y: 200, w: 400, h: 300, rotation: Math.PI / 2,
    });
    editor = makeEditor(store, canvas, overlay);

    editor.enterImageCrop(id);
    expect(editor.isCropping()).toBe(true);
    // The 'e' handle sits at the rotated east edge: world (400, 550).
    const e = handleCenter(overlay, 'e');
    expect(e.x).toBeCloseTo(400);
    expect(e.y).toBeCloseTo(550);
    // Pull it 100px toward the centre (world -y) → local east edge in 100.
    drag(overlay, e, { x: e.x, y: e.y - 100 });
    key('Enter');

    const img = image(store, sid, id);
    expect(img.frame.rotation).toBeCloseTo(Math.PI / 2);
    expect(img.frame.w).toBeCloseTo(300);
    expect(img.frame.h).toBeCloseTo(300);
    // Trimming the width by 100/400 leaves crop.w = 0.75.
    expect(img.data.crop).toBeDefined();
    expect(img.data.crop!.w).toBeCloseTo(0.75);
    expect(img.data.crop!.h).toBeCloseTo(1);
  });

  it('ignores a pointermove after the session ends mid-drag', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('blank'); });
    const id = addImage(store, sid, { x: 200, y: 200, w: 400, h: 300 });
    editor = makeEditor(store, canvas, overlay);

    editor.enterImageCrop(id);
    const e = handleCenter(overlay, 'e');
    // Begin a handle drag but do not release.
    overlay.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: e.x, clientY: e.y, button: 0, bubbles: true,
      }),
    );
    // Session ends (e.g. Esc / programmatic exit) before pointerup.
    editor.exitImageCrop(false);
    expect(editor.isCropping()).toBe(false);
    // A late pointermove must not throw or mutate the (committed) store.
    expect(() =>
      document.dispatchEvent(
        new PointerEvent('pointermove', { clientX: e.x - 100, clientY: e.y, bubbles: true }),
      ),
    ).not.toThrow();
    const img = image(store, sid, id);
    expect(img.frame.w).toBeCloseTo(400);
    expect(img.data.crop).toBeUndefined();
  });

  it('resetImageCrop clears crop and restores proportions', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('blank'); });
    const id = addImage(store, sid, { x: 200, y: 200, w: 400, h: 300 });
    editor = makeEditor(store, canvas, overlay);

    // Apply a crop first (centre half).
    store.batch(() => {
      store.updateElementData(sid, id, {
        crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      });
    });

    editor.resetImageCrop(id);
    const img = image(store, sid, id);
    expect(img.data.crop).toBeUndefined();
    // full = frame / cropSize: 400/0.5 = 800 wide, 300/0.5 = 600 tall.
    expect(img.frame.w).toBeCloseTo(800);
    expect(img.frame.h).toBeCloseTo(600);
  });
});
