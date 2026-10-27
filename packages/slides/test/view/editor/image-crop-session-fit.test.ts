// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type { ImageElement, ImageFit } from '../../../src/model/element';

// The crop session needs the bitmap's natural size, which jsdom never
// loads; stand in a loaded 200x100 bitmap for every src.
vi.mock('../../../src/view/canvas/image-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/view/canvas/image-cache')>();
  return {
    ...actual,
    getOrLoadImage: () =>
      ({ complete: true, naturalWidth: 200, naturalHeight: 100 }) as HTMLImageElement,
  };
});

function setup(fit: ImageFit | undefined) {
  document.body.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  let sid = '';
  let id = '';
  store.batch(() => {
    sid = store.addSlide('blank');
    id = store.addElement(sid, {
      type: 'image',
      frame: { x: 200, y: 200, w: 400, h: 400, rotation: 0 },
      data: { src: 'data:image/png;base64,AAAA', ...(fit ? { fit } : {}) },
    });
  });
  const editor = initialize({
    canvas, overlay, store,
    hostWidth: 1920, hostHeight: 1080, dpr: 1,
    mountTextBox: () => { throw new Error('not used'); },
  });
  const read = () =>
    store.read().slides.find((s) => s.id === sid)!
      .elements.find((e) => e.id === id) as ImageElement;
  return { editor, id, read };
}

describe('image crop session with fit', () => {
  let editor: SlidesEditor | null = null;
  afterEach(() => {
    if (editor) { editor.detach(); editor = null; }
  });

  it("commits a 'cover' image as the centre crop it was painted with", () => {
    const t = setup('cover');
    editor = t.editor;
    editor.enterImageCrop(t.id);
    editor.exitImageCrop(true);
    const img = t.read();
    expect(img.data.fit).toBeUndefined();
    expect(img.data.crop?.x).toBeCloseTo(0.25);
    expect(img.data.crop?.w).toBeCloseTo(0.5);
    expect(img.frame).toMatchObject({ x: 200, y: 200, w: 400, h: 400 });
  });

  it("commits a 'contain' image as the letterboxed frame, uncropped", () => {
    const t = setup('contain');
    editor = t.editor;
    editor.enterImageCrop(t.id);
    editor.exitImageCrop(true);
    const img = t.read();
    expect(img.data.fit).toBeUndefined();
    expect(img.data.crop).toBeUndefined();
    // 200x100 in a 400x400 frame, never upscaled → 200x100 centred.
    expect(img.frame.x).toBeCloseTo(300);
    expect(img.frame.y).toBeCloseTo(350);
    expect(img.frame.w).toBeCloseTo(200);
    expect(img.frame.h).toBeCloseTo(100);
  });

  it('leaves a fitted image untouched on cancel', () => {
    const t = setup('cover');
    editor = t.editor;
    editor.enterImageCrop(t.id);
    editor.exitImageCrop(false);
    const img = t.read();
    expect(img.data.fit).toBe('cover');
    expect(img.data.crop).toBeUndefined();
  });

  it('an unfitted image still starts from the plain stretch', () => {
    const t = setup(undefined);
    editor = t.editor;
    editor.enterImageCrop(t.id);
    editor.exitImageCrop(true);
    const img = t.read();
    expect(img.data.crop).toBeUndefined();
    expect(img.frame).toMatchObject({ x: 200, y: 200, w: 400, h: 400 });
  });
});
