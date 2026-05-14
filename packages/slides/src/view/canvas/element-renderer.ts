import type { Element } from '../../model/element';
import type { PlaceholderStyle } from '../../model/master';
import { placeholderHintFor } from '../../model/placeholder-hints';
import type { SlidesDocument } from '../../model/presentation';
import type { Theme } from '../../model/theme';
import { drawShape } from './shape-renderer';
import { drawText } from './text-renderer';
import { drawImage } from './image-renderer';

/**
 * Draw an element in world coordinates. Sets up the frame transform
 * (translate + rotate around frame centre), dispatches to the
 * type-specific painter, and restores the ctx state. Per-type painters
 * always work in element-local coordinates.
 *
 * `doc` and `theme` are threaded in so shape/text painters can resolve
 * `ThemeColor`/`ThemeFont` against the deck's active theme. The image
 * painter intentionally ignores the theme — its placeholder colors are
 * a system-fallback UI, not themed content.
 *
 * `onAssetLoad` is invoked the first time an async resource (currently
 * only images) finishes loading. The slide-renderer wires this to a
 * re-render request so the slide repaints once the asset arrives.
 */
export function drawElement(
  ctx: CanvasRenderingContext2D,
  element: Element,
  doc: SlidesDocument,
  theme: Theme,
  onAssetLoad: () => void,
): void {
  const { frame } = element;
  ctx.save();
  // try/finally so the ctx state is always restored, even if a
  // per-type painter throws. Without this, a single corrupted element
  // (e.g. malformed image data) leaks the rotate / translate transform
  // into every subsequent element on the slide.
  try {
    if (frame.rotation === 0) {
      ctx.translate(frame.x, frame.y);
    } else {
      ctx.translate(frame.x + frame.w / 2, frame.y + frame.h / 2);
      ctx.rotate(frame.rotation);
      ctx.translate(-frame.w / 2, -frame.h / 2);
    }
    const size = { w: frame.w, h: frame.h };
    switch (element.type) {
      case 'shape':
        drawShape(ctx, size, element.data, theme);
        break;
      case 'text': {
        // Only ref-bearing elements get a ghost hint — user-added text
        // boxes (no `placeholderRef`) must remain blank when empty.
        // Slot typography (font role + size, color role, alignment)
        // comes from the active master so the hint matches what the
        // user will see when they start typing.
        let placeholderHint:
          | { text: string; style: PlaceholderStyle }
          | undefined;
        if (element.placeholderRef) {
          const master =
            doc.masters.find((m) => m.id === doc.meta.masterId)
            ?? doc.masters[0];
          const style =
            master?.placeholderStyles[element.placeholderRef.type]
            ?? master?.placeholderStyles.body;
          if (style) {
            placeholderHint = {
              text: placeholderHintFor(element.placeholderRef.type),
              style,
            };
          }
        }
        drawText(ctx, size, element.data, theme, { placeholderHint });
        break;
      }
      case 'image':
        drawImage(ctx, size, element.data, onAssetLoad);
        break;
      case 'connector':
        throw new Error(
          'connector rendering not implemented yet (PR1 Task 9)',
        );
    }
  } finally {
    ctx.restore();
  }
  // `doc` is threaded for forward compatibility — Task 4 wires the
  // text renderer to a colorResolver that closes over the deck's
  // resolved palette.
  void doc;
}
