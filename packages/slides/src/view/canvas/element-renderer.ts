import type { Element } from '../../model/element';
import type { AnimState } from '../../anim/state';
import type { PlaceholderStyle } from '../../model/master';
import { placeholderHintFor } from '../../model/placeholder-hints';
import type { SlidesDocument } from '../../model/presentation';
import { deckFontScale } from '../../model/presentation';
import type { Theme } from '../../model/theme';
import {
  IDENTITY_GROUP_TRANSFORM,
  composeGroupMatrix,
  groupToTransform,
  type GroupTransform,
} from '../../model/group';
import { drawConnector } from './connector-renderer';
import { drawShape, paintShapeText } from './shape-renderer';
import { drawTable } from './table-renderer';
import { drawText } from './text-renderer';
import { drawImage } from './image-renderer';
import { applyShadow, clearShadow, paintReflection } from './effects-renderer';

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
 *
 * `anim` is the optional animation transform (opacity / translate / scale
 * / rotation in slide-space) applied around the element centre before the
 * static paint. When absent or identity the render path is byte-identical
 * to the un-animated path. `anim.hidden` skips the paint entirely. The
 * static body lives in `drawElementBody`; this wrapper only layers the
 * animation transform so #387's effect rendering stays untouched.
 */
export function drawElement(
  ctx: CanvasRenderingContext2D,
  element: Element,
  doc: SlidesDocument,
  theme: Theme,
  onAssetLoad: () => void,
  elementsLookup: ReadonlyMap<string, Element> = EMPTY_LOOKUP,
  parentFlip: FlipState = NO_FLIP,
  parentTransform: GroupTransform = IDENTITY_GROUP_TRANSFORM,
  anim?: AnimState,
): void {
  if (anim?.hidden) return;
  const hasAnim =
    !!anim &&
    (anim.opacity !== 1 ||
      anim.scale !== 1 ||
      anim.dx !== 0 ||
      anim.dy !== 0 ||
      anim.rotation !== 0);
  if (!hasAnim) {
    drawElementBody(
      ctx, element, doc, theme, onAssetLoad,
      elementsLookup, parentFlip, parentTransform,
    );
    return;
  }
  ctx.save();
  try {
    ctx.globalAlpha *= anim!.opacity;
    ctx.translate(anim!.dx, anim!.dy);
    const cx = element.frame.x + element.frame.w / 2;
    const cy = element.frame.y + element.frame.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(anim!.scale, anim!.scale);
    ctx.rotate(anim!.rotation);
    ctx.translate(-cx, -cy);
    drawElementBody(
      ctx, element, doc, theme, onAssetLoad,
      elementsLookup, parentFlip, parentTransform,
    );
  } finally {
    ctx.restore();
  }
}

function drawElementBody(
  ctx: CanvasRenderingContext2D,
  element: Element,
  doc: SlidesDocument,
  theme: Theme,
  onAssetLoad: () => void,
  elementsLookup: ReadonlyMap<string, Element> = EMPTY_LOOKUP,
  parentFlip: FlipState = NO_FLIP,
  parentTransform: GroupTransform = IDENTITY_GROUP_TRANSFORM,
): void {
  // Connectors paint directly in world coordinates and need a lookup map
  // to resolve attached endpoints — skip the per-element frame transform.
  if (element.type === 'connector') {
    // Inside a group the ctx already has the group's transform applied
    // and the connector's own `start.x/y` / `end.x/y` for free endpoints
    // are stored in group-local space (store.group() normalises them).
    // `buildElementWorldLookup` re-lifts those free endpoints into world
    // space, and attached endpoints always resolve through the lookup
    // against world frames — so the lookup's connector is the single
    // source of truth for "world-coordinate endpoints".
    //
    // We undo the parent-group transform so the ctx is back at
    // slide-world, then hand drawConnector the lookup's view of the
    // connector. Both endpoint kinds now agree on world coords; the
    // bug where attached endpoints drifted by the group's translation
    // (and free endpoints stayed correct only by coincidence) is gone.
    if (parentTransform !== IDENTITY_GROUP_TRANSFORM) {
      const inv = invertGroupTransform(parentTransform);
      // Singular parent transform — group has zero width or height. Skip
      // the connector rather than crashing the slide; the broken group
      // is visible on its own.
      if (inv === null) return;
      const worldEl = (elementsLookup.get(element.id) ?? element) as typeof element;
      ctx.save();
      ctx.transform(inv.a, inv.b, inv.c, inv.d, inv.tx, inv.ty);
      drawConnector(ctx, worldEl, elementsLookup, theme);
      ctx.restore();
    } else {
      drawConnector(ctx, element, elementsLookup, theme);
    }
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
      // Connector children take the early return at the top of
      // drawElement and use `childTransform` to undo this ctx layer
      // before painting in world coords — see the connector branch above.
      const childTransform = composeGroupMatrix(
        parentTransform,
        groupToTransform(element),
      );
      for (const child of element.data.children) {
        drawElement(
          ctx, child, doc, theme, onAssetLoad,
          elementsLookup, totalFlip, childTransform,
        );
      }
    } else {
      // Resolved per-deck so PPTX decks authored at a non-default
      // physical size render text at the proportion their source
      // expects. Decks without `meta.pxPerPt` (everything in-app
      // authored before this change) keep `1` here — no regression.
      const fontScale = deckFontScale(doc.meta);
      // Drop shadow is applied to single-silhouette leaves only
      // (shape / image / text). Multi-draw elements (table, group) would
      // cast a separate shadow per cell / child with `ctx.shadow*`, so
      // they are excluded here and in the panel's section routing.
      const shadow = element.data.effects?.shadow;
      // Reflection is a separate faded mirror painted below the element
      // (single-silhouette leaves only — shape / image / text).
      const reflection = element.data.effects?.reflection;
      switch (element.type) {
        case 'shape':
          // Geometry paints under the accumulated flip transform — fills,
          // strokes, and path outlines are supposed to mirror. Text inside
          // the shape is then painted under a centred counter-flip so
          // glyphs stay readable (PowerPoint / Google Slides behavior).
          if (shadow) applyShadow(ctx, shadow, theme);
          drawShape(ctx, size, element.data, theme);
          // Clear before the text pass so glyphs aren't double-shadowed
          // on top of the already-shadowed fill.
          if (shadow) clearShadow(ctx);
          withCounterFlip(ctx, size, totalFlip, () => {
            paintShapeText(ctx, size, element.data, theme, fontScale);
          });
          if (reflection) {
            paintReflection(ctx, size, reflection, (t) => {
              drawShape(t, size, element.data, theme);
              // Match the main pass: geometry mirrors with the element's
              // flip (applied when the mirror is blitted), text stays
              // readable via counter-flip. No-op when the element isn't
              // flipped.
              withCounterFlip(t, size, totalFlip, () => {
                paintShapeText(t, size, element.data, theme, fontScale);
              });
            });
          }
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
          if (shadow) applyShadow(ctx, shadow, theme);
          withCounterFlip(ctx, size, totalFlip, () => {
            drawText(ctx, size, element.data, theme, {
              placeholderHint,
              fontScale,
            });
          });
          if (reflection) {
            paintReflection(ctx, size, reflection, (t) => {
              // Mirror the main pass's counter-flip so reflected text keeps
              // the same orientation as the element under flipH / flipV.
              withCounterFlip(t, size, totalFlip, () => {
                drawText(t, size, element.data, theme, {
                  placeholderHint,
                  fontScale,
                });
              });
            });
          }
          break;
        }
        case 'image':
          // Images intentionally mirror with flipH/flipV — the user is
          // flipping a picture, so no counter-flip is applied.
          if (shadow) applyShadow(ctx, shadow, theme);
          drawImage(ctx, size, element.data, onAssetLoad);
          if (reflection) {
            paintReflection(ctx, size, reflection, (t) => {
              drawImage(t, size, element.data, onAssetLoad);
            });
          }
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

/**
 * Affine inverse of a GroupTransform in the 6-coefficient form
 * `ctx.transform` consumes. Used to undo the cumulative parent-group
 * transform before drawing a grouped connector in world coords.
 *
 * The math matches `applyInverseMatrix` in model/group.ts but returns
 * the raw a/b/c/d/tx/ty fields needed by the canvas API.
 *
 * Returns `null` instead of throwing when the matrix is singular
 * (det ≈ 0) — this lives in the render hot path and a throw inside
 * `drawConnector` would escape `drawElement`'s try/finally and abort
 * the rest of `drawSlide`'s element loop, blanking the slide. A
 * degenerate group should drop the connector silently and let the
 * rest of the slide paint; the offending group has bigger problems
 * the user can see and fix separately.
 */
function invertGroupTransform(t: GroupTransform): {
  a: number; b: number; c: number; d: number; tx: number; ty: number;
} | null {
  const det = t.a * t.d - t.b * t.c;
  if (Math.abs(det) < 1e-9) return null;
  return {
    a:  t.d / det,
    b: -t.b / det,
    c: -t.c / det,
    d:  t.a / det,
    tx: -(t.d * t.tx - t.c * t.ty) / det,
    ty:  (t.b * t.tx - t.a * t.ty) / det,
  };
}
