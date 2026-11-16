import { describe, it, expect } from 'vitest';
import { MemNoteStore } from '../store/memory.js';
import { initialize } from './editor.js';

/**
 * jsdom has no layout, so each pane gets a fixed 1000px scroll range and a
 * plain `scrollTop`. Events are dispatched by hand in the order a browser
 * fires them: a programmatic `scrollTop` write reaches its element's
 * `scroll` listeners in the NEXT frame, after the user's own scroll of the
 * other pane may already have moved on.
 */
function fakeScrollable(el: HTMLElement) {
  let top = 0;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 1000 });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(1000, Math.round(v)));
    },
  });
}

const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => r()));

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = initialize(container, new MemNoteStore('# a\n\nb'), 'light');
  const src = container.querySelector<HTMLElement>('.cm-scroller')!;
  const preview = container.querySelector<HTMLElement>('.note-preview')!;
  fakeScrollable(src);
  fakeScrollable(preview);
  const scroll = (el: HTMLElement) => el.dispatchEvent(new Event('scroll'));
  const dispose = () => {
    editor.dispose();
    container.remove();
  };
  return { editor, src, preview, scroll, dispose };
}

describe('split-view scroll sync', () => {
  it('does not let the preview echo pull a continuing editor scroll back', async () => {
    const { src, preview, scroll, dispose } = mount();
    try {
      // Frame 1: the user scrolls the source; the preview follows.
      src.scrollTop = 100;
      scroll(src);
      expect(preview.scrollTop).toBe(100);
      await nextFrame();
      // Frame 2: the user is still scrolling (108), and the preview's echo
      // of frame 1's write arrives first. It must not drag the source back
      // to 100.
      src.scrollTop = 108;
      scroll(preview);
      expect(src.scrollTop).toBe(108);
      scroll(src);
      expect(preview.scrollTop).toBe(108);
    } finally {
      dispose();
    }
  });

  it('still follows a scroll the user starts in the preview', async () => {
    const { src, preview, scroll, dispose } = mount();
    try {
      src.scrollTop = 100;
      scroll(src);
      await nextFrame();
      scroll(preview); // the echo of that write, ignored
      await nextFrame();
      preview.scrollTop = 500;
      scroll(preview);
      expect(src.scrollTop).toBe(500);
    } finally {
      dispose();
    }
  });

  it('forgets an unfired echo when the view mode changes', async () => {
    const { editor, src, preview, scroll, dispose } = mount();
    try {
      // The preview follows to 100, then is hidden before its echo fires.
      src.scrollTop = 100;
      scroll(src);
      editor.setViewMode('edit');
      src.scrollTop = 300; // no sync while the preview is hidden
      editor.setViewMode('both');
      // A genuine preview scroll that happens to land on 100 must drive the
      // source, not be mistaken for the stale echo.
      scroll(preview);
      expect(src.scrollTop).toBe(100);
    } finally {
      dispose();
    }
  });
});
