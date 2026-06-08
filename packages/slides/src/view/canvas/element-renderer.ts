import type { Element } from '../../model/element';
import type { PlaceholderStyle } from '../../model/master';
import { placeholderHintFor } from '../../model/placeholder-hints';
import type { SlidesDocument } from '../../model/presentation';
import { deckFontScale } from '../../model/presentation';
import type { Theme } from '../../model/theme';
import { drawConnector } from './connector-renderer';
import { drawShape, paintShapeText } from './shape-renderer';
import { drawTable } from './table-renderer';
import { drawText } from './text-renderer';
import { drawImage } from './image-renderer';

const EMPTY_LOOKUP: ReadonlyMap<string, Element> = new Map();

/**
 * Accumulated flip from ancestor groups + this element. Threaded
 * through `drawElement` recursion so a text leaf inside a flipped
 * group can counter-flip against the total accumulated flip, not just
 * its own.
 */
type FlipState = { h: boolean; v: boolean };
const NO_FLIP: FlipState = { h: false, v: false };

/**
 * Paint a child callback inside a centred counter-flip transform so
 * its content is NOT mirrored even when the surrounding context has
 * accumulated `flipH` / `flipV`. Used for text (inline shape text +
 * standalone text elements): PowerPoint / Google Slides keep text
 * glyphs readable when a shape is flipped — only the geometry mirrors.
 *
 * Centred flip is its own inverse, so applying the same operation
 * around the same centre cancels the accumulated flip without
 * disturbing the surrounding rotation or scale.
 */
function withCounterFlip(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  flip: FlipState,
  paint: () => void,
): void {
  if (!flip.h && !flip.v) {
    paint();
    return;
  }
  ctx.save();
  try {
    ctx.translate(size.w / 2, size.h / 2);
    ctx.scale(flip.h ? -1 : 1, flip.v ? -1 : 1);
    ctx.translate(-size.w / 2, -size.h / 2);
    paint();
  } finally {
    ctx.restore();
  }
}

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
  elementsLookup: ReadonlyMap<string, Element> = EMPTY_LOOKUP,
  parentFlip: FlipState = NO_FLIP,
): void {
  // Connectors paint directly in world coordinates and need a lookup map
  // to resolve attached endpoints — skip the per-element frame transform.
  if (element.type === 'connector') {
    drawConnector(ctx, element, elementsLookup, theme);
    return;
  }

  const { frame } = element;
  // Accumulated flip = ancestor flip XOR own flip. Threaded to children
  // (groups) so a nested text leaf un-flips against the total flip, and
  // used here to wrap text painting in a counter-flip even at the top
  // level (no parent, parentFlip = NO_FLIP).
  const ownFlipH = !!frame.flipH;
  const ownFlipV = !!frame.flipV;
  const totalFlip: FlipState = {
    h: parentFlip.h !== ownFlipH,
    v: parentFlip.v !== ownFlipV,
  };
  ctx.save();
  // try/finally so the ctx state is always restored, even if a
  // per-type painter throws. Without this, a single corrupted element
  // (e.g. malformed image data) leaks the rotate / translate transform
  // into every subsequent element on the slide.
  try {
    const flipped = ownFlipH || ownFlipV;

    // For groups, children are stored in the group's local reference space
    // (0..refSize.w × 0..refSize.h). We must scale that space to match the
    // on-screen bbox (0..frame.w × 0..frame.h) so children scale
    // proportionally when the group is resized. For non-group elements, the
    // local space IS the frame, so refW/refH equal frame.w/h (scale = 1).
    const isGroup = element.type === 'group';
    const refW = isGroup ? (element.data.refSize?.w ?? frame.w) : frame.w;
    const refH = isGroup ? (element.data.refSize?.h ?? frame.h) : frame.h;
    const scaleX = refW > 0 ? frame.w / refW : 1;
    const scaleY = refH > 0 ? frame.h / refH : 1;
    const needsTransform =
      frame.rotation !== 0 || flipped || scaleX !== 1 || scaleY !== 1;

    if (!needsTransform) {
      ctx.translate(frame.x, frame.y);
    } else {
      // Centre-relative transform: rotate, then flip, then scale the local
      // space, then move the local origin back to the frame top-left.
      // Flip uses the same centre as rotation, matching OOXML
      // <a:xfrm flipH/flipV> semantics. The frame rect itself is unchanged,
      // so hit-test and selection-box math stay valid.
      ctx.translate(frame.x + frame.w / 2, frame.y + frame.h / 2);
      if (frame.rotation !== 0) ctx.rotate(frame.rotation);
      if (flipped) {
        ctx.scale(frame.flipH ? -1 : 1, frame.flipV ? -1 : 1);
      }
      if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
      // Use refW/refH here so the local origin lands at the top-left of the
      // local (reference) space, not of the scaled frame.
      ctx.translate(-refW / 2, -refH / 2);
    }
    // Per-type painters work in local space; for groups that is the refSize
    // space. For non-groups refW/refH == frame.w/h, so size is unchanged.
    const size = { w: refW, h: refH };
    if (element.type === 'group') {
      // Recurse into the group's children. Each child's frame is in
      // group-local coordinates (0..w × 0..h), so painting them under
      // the group's own frame transform places them correctly in world
      // space. Arbitrary nesting depth is handled by recursion.
      //
      // NOTE: Connectors inside groups are painted in raw ctx space
      // (drawConnector returns before the frame transform is applied).
      // In v1, group() never includes connectors as children (Task 11
      // invariant), so this is safe. A TODO remains for v2+ support.
      for (const child of element.data.children) {
        drawElement(ctx, child, doc, theme, onAssetLoad, elementsLookup, totalFlip);
      }
    } else {
      // Resolved per-deck so PPTX decks authored at a non-default
      // physical size render text at the proportion their source
      // expects. Decks without `meta.pxPerPt` (everything in-app
      // authored before this change) keep `1` here — no regression.
      const fontScale = deckFontScale(doc.meta);
      switch (element.type) {
        case 'shape':
          // Geometry paints under the accumulated flip transform — fills,
          // strokes, and path outlines are supposed to mirror. Text inside
          // the shape is then painted under a centred counter-flip so
          // glyphs stay readable (PowerPoint / Google Slides behavior).
          drawShape(ctx, size, element.data, theme);
          withCounterFlip(ctx, size, totalFlip, () => {
            paintShapeText(ctx, size, element.data, theme, fontScale);
          });
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
          // Text glyphs are never mirrored; counter-flip the accumulated
          // flip so the box position still mirrors (via the surrounding
          // transform) but the text inside reads left-to-right.
          withCounterFlip(ctx, size, totalFlip, () => {
            drawText(ctx, size, element.data, theme, {
              placeholderHint,
              fontScale,
            });
          });
          break;
        }
        case 'image':
          // Images intentionally mirror with flipH/flipV — the user is
          // flipping a picture, so no counter-flip is applied.
          drawImage(ctx, size, element.data, onAssetLoad);
          break;
        case 'table':
          // P1 paints the whole table (fills, borders, AND cell text)
          // under counter-flip, so `frame.flipH` / `frame.flipV` on a
          // TableElement is a visual no-op for now. Diverges from the
          // 'shape' case (geometry mirrors, text counter-flips), but
          // tables are rarely flipped in practice and the OOXML
          // `<p:graphicFrame>` schema doesn't surface flipH/flipV the
          // same way it does on `<p:sp>` shapes. Tracked as a follow-up
          // in `docs/design/slides/slides-tables.md` (Known limitations).
          withCounterFlip(ctx, size, totalFlip, () => {
            drawTable(ctx, size, element.data, theme, { fontScale });
          });
          break;
      }
    }
  } finally {
    ctx.restore();
  }
  // `doc` is threaded for forward compatibility — Task 4 wires the
  // text renderer to a colorResolver that closes over the deck's
  // resolved palette.
  void doc;
}
