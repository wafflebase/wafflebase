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
 * The canvas is cached by (theme, master, layout, size); theme
 * switches naturally route to different keys, so old entries fall
 * out of reachability and become GC eligible without an explicit
 * invalidation API.
 */
export function renderLayoutPreview(
  layout: Layout,
  theme: Theme,
  master: Master,
  size: { w: number; h: number },
): HTMLCanvasElement {
  const key = `${theme.id}:${master.id}:${layout.id}:${size.w}x${size.h}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const slide = syntheticSlide(layout);
    const doc: SlidesDocument = {
      meta: { title: '', themeId: theme.id, masterId: master.id },
      themes: [theme],
      masters: [master],
      layouts: [layout],
      slides: [slide],
    };
    renderThumbnail(ctx, slide, doc, {
      hostWidth: size.w,
      hostHeight: size.h,
      dpr: 1,
    });
  }
  cache.set(key, canvas);
  return canvas;
}
