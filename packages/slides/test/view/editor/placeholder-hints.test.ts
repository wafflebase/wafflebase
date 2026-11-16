// @vitest-environment jsdom
//
// The "Click to add title" ghost on an empty layout placeholder is an
// invitation to edit, so the renderer paints it only when asked
// (`showPlaceholderHints`). The editor is the one surface that asks — and
// only when it is editable: a read-only mount (share-link viewer, mobile
// view) shows the slide the way the audience would.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';

let painted: string[] = [];
const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  document.body.innerHTML = '';
  painted = [];
  HTMLCanvasElement.prototype.getContext = function patched(
    this: HTMLCanvasElement,
    contextId: string,
    ...rest: unknown[]
  ): unknown {
    const ctx = (
      originalGetContext as (this: HTMLCanvasElement, ...a: unknown[]) => unknown
    ).call(this, contextId, ...rest) as Record<string, unknown> | null;
    if (contextId === '2d' && ctx) {
      const inner = ctx.fillText as (...a: unknown[]) => unknown;
      ctx.fillText = (...args: unknown[]) => {
        painted.push(String(args[0]));
        return inner.apply(ctx, args);
      };
    }
    return ctx;
  } as HTMLCanvasElement['getContext'];
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function mount(readOnly: boolean): SlidesEditor {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => {
    store.addSlide('title-slide');
  });
  return initialize({
    canvas,
    overlay,
    store,
    hostWidth: 1920,
    hostHeight: 1080,
    dpr: 1,
    readOnly,
  });
}

const hintPainted = () => painted.some((t) => t.startsWith('Click to add'));

describe('editor placeholder hints', () => {
  let editor: SlidesEditor | null = null;

  afterEach(() => {
    editor?.detach();
    editor = null;
  });

  it('paints the hint on an editable canvas', () => {
    editor = mount(false);
    editor.render();
    expect(hintPainted()).toBe(true);
  });

  it('paints no hint on a read-only canvas', () => {
    editor = mount(true);
    editor.render();
    expect(hintPainted()).toBe(false);
  });
});
