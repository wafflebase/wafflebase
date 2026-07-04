import type { FreeformPath, ShapeElement, ShapeKind, TextInset } from '../../model/element';
import { applyShade, resolveColor, type Theme } from '../../model/theme';
import { drawActionButton } from './shape-special';
import { drawArrowhead } from './arrowhead-renderer';
import { resolveStrokeColor } from './render-context';
import {
  FACE_BUILDERS,
  LEADER_BUILDERS,
  OUTLINE_BUILDERS,
  PATH_BUILDERS,
} from './shapes';
import { isActionButton } from './shapes/action-buttons';
import type { FrameSize } from './shapes/builder';
import { buildFreeformPath } from './shapes/freeform';
import { GENERATED_SHAPE_TEXT_RECTS } from './shapes/shape-text-rects.generated';
import { paintTextBody } from './text-renderer';

export type { FrameSize } from './shapes/builder';
// `TextInset` lives in the model layer (used by `TextBody.inset`); re-exported
// here so existing view/editor callers keep importing it from the renderer.
export type { TextInset } from '../../model/element';

/**
 * Insets (in deck-canvas px at the default 1920×1080 size) applied when
 * painting a shape's `data.text`. Mirrors PowerPoint's default
 * `<a:bodyPr lIns="91440" tIns="45720">` — 0.1" / 0.05" — converted at
 * the deck scale (91440 EMU × 1920 / 12192000 EMU = 14.4 px;
 * 45720 EMU × 1920 / 12192000 EMU = 7.2 px). These match what an
 * unmodified shape in PowerPoint / Google Slides shows so inserted
 * shapes look right out of the box.
 *
 * Exported so the editor's `enterEditMode` can inset the in-place
 * text-box editing frame by the same amount — the user's caret and
 * glyphs while editing land where the committed paint will, without
 * a visible "shift" on commit.
 */
export const SHAPE_TEXT_PADDING = { x: 14.4, y: 7.2 } as const;

/**
 * Per-`ShapeKind` text rectangle from the OOXML preset geometry's
 * `<rect l t r b>` element, as fractions of the frame (0..1). PowerPoint
 * lays a shape's text inside this rectangle — for non-rectangular shapes
 * it is meaningfully inset from the bounding box so glyphs stay clear of
 * the silhouette's curves. Only kinds whose preset rect differs from the
 * full frame appear; kinds absent here use the full frame.
 *
 * The table is generated from the canonical `presetShapeDefinitions.xml`
 * (see `scripts/gen-shape-text-rects.mjs`); the chosen rect is composed
 * with the default `SHAPE_TEXT_PADDING` (PowerPoint's default `bodyPr`
 * inset, applied *inside* the preset rect) at the use sites in
 * {@link shapeTextInset}.
 */
export const SHAPE_TEXT_RECTS: Partial<
  Record<ShapeKind, { l: number; t: number; r: number; b: number }>
> = GENERATED_SHAPE_TEXT_RECTS;

/**
 * Text inset (px per side) for a shape's inline text: the kind's preset
 * text rectangle (if any) plus the default `SHAPE_TEXT_PADDING`. Shapes
 * without a preset rect fall back to a uniform `SHAPE_TEXT_PADDING` on
 * every side — i.e. the historical full-frame-minus-padding box.
 */
// Known limitation: for shapes with a very narrow preset rect (e.g.
// `leftRightRibbon`, `lightningBolt`), the composed inset can drive the inner
// text box to zero width/height at small frame sizes — `paintTextBody` clamps
// to `Math.max(0, …)`, so text simply doesn't render, matching PowerPoint's own
// confinement of inline text to that narrow band rather than overflowing.
// `pad` overrides the default `SHAPE_TEXT_PADDING` term when supplied — used
// to honor a shape's imported `<a:bodyPr>` insets (`data.text.inset`) while
// still composing them with the kind's preset text rectangle.
export function shapeTextInset(
  kind: ShapeKind,
  w: number,
  h: number,
  pad?: TextInset,
): TextInset {
  const p = pad ?? {
    left: SHAPE_TEXT_PADDING.x,
    top: SHAPE_TEXT_PADDING.y,
    right: SHAPE_TEXT_PADDING.x,
    bottom: SHAPE_TEXT_PADDING.y,
  };
  const rect = SHAPE_TEXT_RECTS[kind];
  if (!rect) {
    return { ...p };
  }
  return {
    left: rect.l * w + p.left,
    top: rect.t * h + p.top,
    right: (1 - rect.r) * w + p.right,
    bottom: (1 - rect.b) * h + p.bottom,
  };
}

/**
 * The inset text frame for a shape, in the same coordinate space as the
 * passed frame. Used by the editor so the in-place editing box and caret
 * land exactly where {@link paintShapeText} paints the committed glyphs.
 */
export function shapeTextFrame(
  kind: ShapeKind,
  frame: { x: number; y: number; w: number; h: number; rotation: number },
  pad?: TextInset,
): { x: number; y: number; w: number; h: number; rotation: number } {
  const ins = shapeTextInset(kind, frame.w, frame.h, pad);
  return {
    x: frame.x + ins.left,
    y: frame.y + ins.top,
    w: Math.max(0, frame.w - ins.left - ins.right),
    h: Math.max(0, frame.h - ins.top - ins.bottom),
    rotation: frame.rotation,
  };
}

const placeholderWarned = new Set<string>();

/**
 * Shape kinds whose path geometry depends on the `evenodd` fill rule.
 * The dispatcher passes `'evenodd'` to `ctx.fill(path, ...)` for these
 * kinds so concentric counter-clockwise sub-paths punch holes (donut)
 * rather than filling the whole interior. `noSmoking` also relies on
 * even-odd because its inner holes are C-shaped sub-paths whose CCW
 * winding would otherwise need real winding-rule support to register
 * as holes in the JSDOM test shim.
 */
export const EVENODD_KINDS: ReadonlySet<ShapeKind> = new Set([
  'donut',
  'noSmoking',
]);

/**
 * Shape kinds whose `PathBuilder` returns an open (un-`closePath`'d)
 * polyline. Stroking traces just the visible outline as intended,
 * but `ctx.fill()` auto-closes the path with a straight line —
 * producing a misleading filled shape (e.g. an open `leftBracket`
 * fills as a C-rect rather than a thin bracket outline).
 *
 * Brackets and braces are the only such kinds today: OOXML defines
 * them with separate fill / stroke paths that we collapse into a
 * single stroke-oriented polyline. Real-world PPTX usage is
 * overwhelmingly `<a:noFill/>` (the user-supplied Yorkie deck has
 * stroke-only brackets), but a future deck with a filled bracket
 * would silently render incorrectly without this guard.
 */
export const OPEN_PATH_KINDS: ReadonlySet<ShapeKind> = new Set([
  'leftBracket',
  'rightBracket',
  'leftBrace',
  'rightBrace',
  'bracketPair',
  'bracePair',
]);

/**
 * Draw a shape's geometry (fill + stroke / action-button body) into
 * element-local coordinates (top-left at 0,0). The caller is
 * responsible for the frame transform (translate + rotate + flip) AND
 * for calling `paintShapeText` separately — text painting is split out
 * so the caller can wrap it in a counter-flip transform to keep glyphs
 * readable when the shape is flipped (PowerPoint / Google Slides
 * behavior).
 *
 * Action buttons are special-cased (body + glyph). All other kinds
 * resolve through PATH_BUILDERS; unknown kinds fall back to a
 * placeholder rectangle so the slide always renders.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (isActionButton(data.kind)) {
    drawActionButton(ctx, size, data, theme);
    return;
  }

  // Freeform (`<a:custGeom>`) — geometry is data-driven, not parametric.
  // Fall back to a placeholder rect if the path is somehow missing so the
  // slide still renders something at the frame. Filled with the default
  // nonzero winding rule, matching PowerPoint's custGeom rendering.
  if (data.kind === 'freeform') {
    if (!data.path) {
      drawPlaceholderRect(ctx, size, data, theme);
      return;
    }
    paintFillStroke(ctx, buildFreeformPath(size, data.path), data, theme);
    // Line-end arrowheads on an open freeform path (OOXML `<a:tailEnd>` /
    // `<a:headEnd>`). Painted after the stroke so the triangle sits on top,
    // filled with the stroke color — same primitive as connectors.
    if (data.arrowheads && data.stroke) {
      drawFreeformArrowheads(
        ctx,
        size,
        data.path,
        data.arrowheads,
        resolveStrokeColor(data.stroke.color, theme),
      );
    }
    return;
  }

  const builder = PATH_BUILDERS.get(data.kind);
  if (!builder) {
    if (!placeholderWarned.has(data.kind)) {
      placeholderWarned.add(data.kind);
      console.warn(
        `slides: no path builder registered for shape kind "${data.kind}"; ` +
          `falling back to placeholder rect`,
      );
    }
    drawPlaceholderRect(ctx, size, data, theme);
    return;
  }
  // Multi-fill 3D-look / folded shapes (cube, can, bevel, ribbons,
  // scrolls): paint each shaded face from the single fill color, then
  // stroke the union silhouette once.
  const faceBuilder = FACE_BUILDERS.get(data.kind);
  if (faceBuilder) {
    paintFaces(ctx, faceBuilder(size, data.adjustments), data, theme);
    if (data.stroke) {
      ctx.strokeStyle = resolveStrokeColor(data.stroke.color, theme);
      ctx.lineWidth = data.stroke.width;
      ctx.lineJoin = 'round';
      ctx.stroke(builder(size, data.adjustments));
    }
    return;
  }

  const outlineBuilder = OUTLINE_BUILDERS.get(data.kind);
  paintFillStroke(ctx, builder(size, data.adjustments), data, theme, {
    skipFill: OPEN_PATH_KINDS.has(data.kind),
    fillRule: EVENODD_KINDS.has(data.kind) ? 'evenodd' : 'nonzero',
    strokePath: outlineBuilder?.(size, data.adjustments),
  });
  // Border callouts: stroke the separate `fill="none"` leader polyline on
  // top of the filled body, matching the OOXML two-path geometry.
  const leaderBuilder = LEADER_BUILDERS.get(data.kind);
  if (leaderBuilder && data.stroke) {
    ctx.strokeStyle = resolveStrokeColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.lineJoin = 'round';
    ctx.stroke(leaderBuilder(size, data.adjustments));
  }
}

type Pt = { x: number; y: number };

/**
 * Draw the start/end arrowheads of an open freeform path. Coordinates are
 * the path's normalized `[0,1]` commands scaled anisotropically by the
 * frame (`x*w`, `y*h`) — the same space `buildFreeformPath` strokes into —
 * so the tip lands exactly on the stroked endpoint and the tangent matches
 * the drawn curve. The start tangent is reversed to point out of the body,
 * mirroring `connector-renderer`'s `endpointPose`.
 */
function drawFreeformArrowheads(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  path: FreeformPath,
  arrowheads: NonNullable<ShapeElement['data']['arrowheads']>,
  fillColor: string,
): void {
  let first: Pt | undefined; // path's very first anchor (M)
  let startCtrl: Pt | undefined; // outgoing tangent handle of the first segment
  let endTip: Pt | undefined; // last segment's endpoint
  let endCtrl: Pt | undefined; // incoming tangent handle at the last endpoint
  let cur: Pt | undefined; // running current point
  const s = (x: number, y: number): Pt => ({ x: x * w, y: y * h });

  for (const cmd of path.commands) {
    switch (cmd.c) {
      case 'M':
        cur = s(cmd.x, cmd.y);
        if (!first) first = cur;
        break;
      case 'L': {
        const to = s(cmd.x, cmd.y);
        if (!startCtrl) startCtrl = to;
        endCtrl = cur;
        endTip = cur = to;
        break;
      }
      case 'Q': {
        const c1 = s(cmd.x1, cmd.y1);
        const to = s(cmd.x, cmd.y);
        if (!startCtrl) startCtrl = c1;
        endCtrl = c1;
        endTip = cur = to;
        break;
      }
      case 'C': {
        const c1 = s(cmd.x1, cmd.y1);
        const to = s(cmd.x, cmd.y);
        if (!startCtrl) startCtrl = c1;
        endCtrl = s(cmd.x2, cmd.y2);
        endTip = cur = to;
        break;
      }
      case 'A': {
        // True ellipse tangent at each endpoint (not the chord). For the
        // centre-parametric arc P(θ)=(cx+rx·cosθ, cy+ry·sinθ) scaled by the
        // frame, dP/dθ = (−rx·sinθ·w, ry·cosθ·h); the direction of travel
        // flips with the sweep sign. Synthesize a control point one tangent
        // step behind the anchor so `arrowPose` yields the curve tangent.
        const a0 = cmd.start;
        const a1 = cmd.start + cmd.sweep;
        const dir = cmd.sweep >= 0 ? 1 : -1;
        const end = { x: (cmd.cx + cmd.rx * Math.cos(a1)) * w, y: (cmd.cy + cmd.ry * Math.sin(a1)) * h };
        // Outgoing tangent at the arc start (into the body from `cur`).
        const t0 = { x: dir * -cmd.rx * Math.sin(a0) * w, y: dir * cmd.ry * Math.cos(a0) * h };
        // Direction of travel at the arc end (out of `end`).
        const t1 = { x: dir * -cmd.rx * Math.sin(a1) * w, y: dir * cmd.ry * Math.cos(a1) * h };
        if (!startCtrl && cur) startCtrl = { x: cur.x + t0.x, y: cur.y + t0.y };
        endCtrl = { x: end.x - t1.x, y: end.y - t1.y };
        endTip = cur = end;
        break;
      }
      // 'Z' closes the outline; arrowheads decorate open ends, so ignore it.
    }
  }

  // Both ends resolve the same way: the tip sits on the anchor and the angle
  // points from the tangent handle toward the tip, which is "away from the
  // body" at the start (handle = outgoing control) and "direction of travel"
  // at the end (handle = incoming control).
  if (arrowheads.start && first && startCtrl) {
    drawArrowhead(ctx, arrowPose(first, startCtrl, endTip ?? startCtrl), arrowheads.start, fillColor);
  }
  if (arrowheads.end && endTip && endCtrl) {
    drawArrowhead(ctx, arrowPose(endTip, endCtrl, first ?? endCtrl), arrowheads.end, fillColor);
  }
}

/** Tip at `p`, angle from `ctrl` → `p`; `fallback` covers a degenerate handle. */
function arrowPose(p: Pt, ctrl: Pt, fallback: Pt): { x: number; y: number; angle: number } {
  let dx = p.x - ctrl.x;
  let dy = p.y - ctrl.y;
  if (dx === 0 && dy === 0) {
    dx = p.x - fallback.x;
    dy = p.y - fallback.y;
  }
  return { x: p.x, y: p.y, angle: Math.atan2(dy, dx) };
}

/**
 * Paint the shaded faces of a multi-fill shape. Each face is filled with
 * the shape's resolved fill color, lightened/darkened by its `shade`
 * delta. No fill ⇒ no-op (a stroke-only 3D shape shows just its
 * silhouette outline, stroked by the caller).
 */
function paintFaces(
  ctx: CanvasRenderingContext2D,
  faces: ReadonlyArray<{ path: Path2D; shade?: number }>,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (!data.fill) return;
  const base = resolveColor(data.fill, theme);
  for (const face of faces) {
    ctx.fillStyle = face.shade ? applyShade(base, face.shade) : base;
    ctx.fill(face.path);
  }
}

/**
 * Paint a path's fill + stroke from a shape's `data`, the one place that
 * maps `data.fill`/`data.stroke` onto the canvas for every Path2D-based
 * kind (parametric and freeform). `skipFill` suppresses the auto-closing
 * fill for open-path kinds (brackets/braces); `fillRule` selects even-odd
 * winding for kinds with real holes (donut/noSmoking). Round joins keep
 * concave corners (e.g. plus / mathPlus inner notches) from sprouting
 * miter spikes.
 */
function paintFillStroke(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  data: ShapeElement['data'],
  theme: Theme,
  opts?: {
    skipFill?: boolean;
    fillRule?: CanvasFillRule;
    /**
     * Separate perimeter path to stroke instead of `path`. Used by
     * kinds whose filled geometry is a multi-sub-path union (curved
     * arrows) so the body/curl seam is not stroked across the shape.
     */
    strokePath?: Path2D;
  },
): void {
  if (data.fill && !opts?.skipFill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fill(path, opts?.fillRule ?? 'nonzero');
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveStrokeColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.lineJoin = 'round';
    ctx.stroke(opts?.strokePath ?? path);
  }
}

function drawPlaceholderRect(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (data.fill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fillRect(0, 0, w, h);
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveStrokeColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.strokeRect(0, 0, w, h);
  }
}

/**
 * Paint a shape's optional inline text body on top of its fill/stroke,
 * using PowerPoint-default insets and a `'middle'` vertical anchor
 * default (matches what PowerPoint / Google Slides do when a shape is
 * created and the user types into it without changing alignment).
 *
 * No-op when `data.text` is absent. Exported so `element-renderer` can
 * orchestrate the geometry → text paint sequence and wrap text in a
 * counter-flip transform.
 */
export function paintShapeText(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
  fontScale?: number,
): void {
  if (!data.text) return;
  paintTextBody(ctx, size, data.text, theme, {
    // A shape's imported `<a:bodyPr>` insets (if any) replace the default
    // per-kind padding while still composing with the preset text rect.
    inset: shapeTextInset(data.kind, size.w, size.h, data.text.inset),
    defaultVerticalAnchor: 'middle',
    fontScale,
  });
}
