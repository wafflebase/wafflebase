import { describe, it, expect, vi } from 'vitest';
import { MemSlidesStore } from '@wafflebase/slides';
import {
  hasImageFile,
  pickImageFile,
  setupSlidesImagePaths,
} from '@/app/slides/slides-image-input.ts';

const pngFile = () => new File(['bytes'], 'a.png', { type: 'image/png' });

/** Minimal DataTransfer-like stub. */
function transfer(opts: {
  items?: Array<{ kind: string; type: string; file: File | null }>;
  files?: File[];
}) {
  return {
    items: opts.items?.map((i) => ({
      kind: i.kind,
      type: i.type,
      getAsFile: () => i.file,
    })),
    files: opts.files,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('pickImageFile / hasImageFile', () => {
  it('finds an image via items (dragover phase)', () => {
    const file = pngFile();
    const dt = transfer({ items: [{ kind: 'file', type: 'image/png', file }] });
    expect(pickImageFile(dt)).toBe(file);
    expect(hasImageFile(dt)).toBe(true);
  });

  it('finds an image via files (drop / paste phase)', () => {
    const file = pngFile();
    expect(pickImageFile(transfer({ files: [file] }))).toBe(file);
  });

  it('hasImageFile is true mid-drag when getAsFile() returns null', () => {
    // During `dragover` the browser withholds file contents, so
    // getAsFile() is null but item.type is known. The dragover gate must
    // still report true — otherwise preventDefault never runs and drop
    // never fires. (Regression: drag-and-drop silently no-op'd.)
    const dt = transfer({ items: [{ kind: 'file', type: 'image/png', file: null }] });
    expect(hasImageFile(dt)).toBe(true);
    expect(pickImageFile(dt)).toBeNull();
  });

  it('ignores non-image items and a null transfer', () => {
    const text = new File(['x'], 'a.txt', { type: 'text/plain' });
    expect(pickImageFile(transfer({ files: [text] }))).toBeNull();
    expect(pickImageFile(null)).toBeNull();
    expect(hasImageFile(null)).toBe(false);
  });
});

describe('setupSlidesImagePaths', () => {
  function fixture(editingId: string | null = null) {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
    });
    const editor = {
      getEditingElementId: () => editingId,
      getCurrentSlideId: () => slideId,
    };
    const canvasWrap = document.createElement('div');
    document.body.appendChild(canvasWrap);
    const upload = vi.fn(async () => ({ url: 'https://cdn/a.png', w: 200, h: 100 }));
    const cleanup = setupSlidesImagePaths({ canvasWrap, editor, store, upload });
    return { store, slideId, canvasWrap, upload, cleanup };
  }

  function dropEvent(dt: unknown) {
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    return ev;
  }
  function pasteEvent(dt: unknown) {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    return ev;
  }

  const countElements = (store: MemSlidesStore, slideId: string) =>
    store.read().slides.find((s) => s.id === slideId)!.elements.length;

  it('inserts a dropped image onto the current slide', async () => {
    const { store, slideId, canvasWrap, upload, cleanup } = fixture();
    canvasWrap.dispatchEvent(dropEvent(transfer({ files: [pngFile()] })));
    await flush();
    expect(upload).toHaveBeenCalledOnce();
    expect(countElements(store, slideId)).toBe(1);
    cleanup();
  });

  it('inserts a pasted image (document-level listener)', async () => {
    const { store, slideId, upload, cleanup } = fixture();
    document.dispatchEvent(pasteEvent(transfer({ files: [pngFile()] })));
    await flush();
    expect(upload).toHaveBeenCalledOnce();
    expect(countElements(store, slideId)).toBe(1);
    cleanup();
  });

  it('still inserts on drop while a text box is being edited', async () => {
    // Drop is NOT gated on edit mode: the slides text box has no drop
    // handler, so bailing would hand a bare-canvas drop to the browser
    // (which navigates the tab). The drop must be consumed + inserted.
    const { store, slideId, canvasWrap, upload, cleanup } = fixture('el-editing');
    canvasWrap.dispatchEvent(dropEvent(transfer({ files: [pngFile()] })));
    await flush();
    expect(upload).toHaveBeenCalledOnce();
    expect(countElements(store, slideId)).toBe(1);
    cleanup();
  });

  it('does NOT insert on paste while a text box is being edited', async () => {
    const { store, slideId, upload, cleanup } = fixture('el-editing');
    document.dispatchEvent(pasteEvent(transfer({ files: [pngFile()] })));
    await flush();
    expect(upload).not.toHaveBeenCalled();
    expect(countElements(store, slideId)).toBe(0);
    cleanup();
  });

  it('does NOT insert on paste while a modal dialog is open', async () => {
    const { store, slideId, upload, cleanup } = fixture();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const btn = document.createElement('button');
    dialog.appendChild(btn);
    document.body.appendChild(dialog);
    btn.focus();
    document.dispatchEvent(pasteEvent(transfer({ files: [pngFile()] })));
    await flush();
    expect(upload).not.toHaveBeenCalled();
    expect(countElements(store, slideId)).toBe(0);
    cleanup();
    dialog.remove();
  });

  it('removes its listeners on cleanup', async () => {
    const { store, slideId, canvasWrap, upload, cleanup } = fixture();
    cleanup();
    canvasWrap.dispatchEvent(dropEvent(transfer({ files: [pngFile()] })));
    document.dispatchEvent(pasteEvent(transfer({ files: [pngFile()] })));
    await flush();
    expect(upload).not.toHaveBeenCalled();
    expect(countElements(store, slideId)).toBe(0);
  });
});
