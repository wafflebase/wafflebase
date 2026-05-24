import { generateId } from '../../model/element';
import type { Element } from '../../model/element';
import type { Layout, Slide, SlidesDocument } from '../../model/presentation';
import type { Master } from '../../model/master';
import type { Theme } from '../../model/theme';
import { renderThumbnail } from './thumbnail';
import { slotRefsForLayout } from '../../model/layout';

const cache = new Map<string, HTMLCanvasElement>();

/** Test-only handle to clear the module cache between cases. */
export const _previewCacheForTest = cache;

function syntheticSlide(layout: Layout): Slide {
  const refs = slotRefsForLayout(layout);
  const placeholderElements: Element[] = layout.placeholders.map((p, i) => ({
    ...p,
    id: generateId(),
    placeholderRef: refs[i],
  } as Element));
  return {
    id: 'preview',
    layoutId: layout.id,
    background: layout.background ?? { fill: { kind: 'role', role: 'background' } },
    elements: [
      ...placeholderElements,
      ...layout.staticElements,
    ],
    notes: [],
  };
}

/**
 * Render a small preview canvas for a layout against a given theme.
 * The canvas is cached by (theme, master, layout, size, dpr); theme
 * switches and monitor moves naturally route to different keys, so
 * old entries fall out of reachability and become GC eligible
 * without an explicit invalidation API.
 */
export function renderLayoutPreview(
  layout: Layout,
  theme: Theme,
  master: Master,
  size: { w: number; h: number },
): HTMLCanvasElement {
  // Read DPR per call so a window dragged between Retina and a non-
  // Retina monitor mid-session paints the preview at the right
  // density. DPR is part of the cache key so the second display gets
  // a freshly-rendered canvas instead of the first display's bitmap.
  const dpr =
    typeof window !== 'undefined' && window.devicePixelRatio
      ? window.devicePixelRatio
      : 1;
  const key = `${theme.id}:${master.id}:${layout.id}:${size.w}x${size.h}@${dpr}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  // Backing store at device pixels; CSS box at logical pixels.
  // Without the dpr multiplier on width/height, Retina renders a
  // half-resolution bitmap that the browser stretches → blurry.
  canvas.width = Math.round(size.w * dpr);
  canvas.height = Math.round(size.h * dpr);
  canvas.style.width = `${size.w}px`;
  canvas.style.height = `${size.h}px`;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Context unavailable (jsdom without polyfill, headless edge cases).
    // Skip caching so a later call with a real context can still render.
    return canvas;
  }
  const slide = syntheticSlide(layout);
  const doc: SlidesDocument = {
    meta: { title: '', themeId: theme.id, masterId: master.id },
    themes: [theme],
    masters: [master],
    layouts: [layout],
    slides: [slide],
    guides: [],
  };
  renderThumbnail(ctx, slide, doc, {
    hostWidth: size.w,
    hostHeight: size.h,
    dpr,
  });
  cache.set(key, canvas);
  return canvas;
}
