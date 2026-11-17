import {
  computeLayout,
  normalizeBlockStyle,
  type Block,
  type DocumentLayout,
  type TextMeasurer,
} from '@wafflebase/docs';
import type { ConnectorElement } from '../../model/connector';
import { isBlocksEmpty, type Element, type Frame, type TextBody } from '../../model/element';
import { scaleBlocks } from '../../model/autofit';
import { buildConnectorPath } from './connector-frame';
import { type ConnectorPath, type Point, isBezierPath } from './routing';

/**
 * Connector label geometry, Node-safe (no Canvas): the caller supplies
 * the `TextMeasurer`. The browser renderer, hit-testing and editor go
 * through `connector-label.ts`, which supplies a Canvas measurer; the
 * PPTX exporter passes the Node width estimate. Both place the label
 * with {@link placeConnectorLabel}, so they agree on where it is.
 *
 * A label is centred on the path midpoint over a knockout of the theme
 * background (FigJam, Miro and Visio all draw them this way), in a box
 * sized to its content up to {@link LABEL_MAX_WIDTH}.
 */

/** Widest a label line may get before it wraps (deck px). */
export const LABEL_MAX_WIDTH = 320;
/** Knockout padding around the text (deck px). */
export const LABEL_PADDING = { x: 8, y: 4 } as const;
/** Default label font size (pt): smaller than body text, like FigJam's. */
export const LABEL_FONT_SIZE = 14;

/** True when `label` is absent or carries no visible characters. */
export function isLabelEmpty(label: TextBody | undefined): boolean {
  return !label || isBlocksEmpty(label.blocks);
}

/**
 * The point halfway along the path by arc length: the middle of the
 * routed polyline for straight / elbow, a sampled arc-length midpoint
 * for a bezier. Halfway by length (not the chord midpoint) keeps an
 * elbow's label on the line rather than in the empty corner.
 */
export function pathMidpoint(path: ConnectorPath): Point {
  const pts = isBezierPath(path) ? sampleBezier(path, 32) : path.points;
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return { ...pts[0] };
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d);
    total += d;
  }
  if (total === 0) return { ...pts[0] };
  let remaining = total / 2;
  for (let i = 0; i < seg.length; i++) {
    if (remaining <= seg[i] || i === seg.length - 1) {
      const t = seg[i] === 0 ? 0 : Math.min(1, remaining / seg[i]);
      const a = pts[i];
      const b = pts[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= seg[i];
  }
  return { ...pts[pts.length - 1] };
}

function sampleBezier(
  b: { p0: Point; c1: Point; c2: Point; p1: Point },
  n: number,
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const k0 = u * u * u;
    const k1 = 3 * u * u * t;
    const k2 = 3 * u * t * t;
    const k3 = t * t * t;
    out.push({
      x: k0 * b.p0.x + k1 * b.c1.x + k2 * b.c2.x + k3 * b.p1.x,
      y: k0 * b.p0.y + k1 * b.c1.y + k2 * b.c2.y + k3 * b.p1.y,
    });
  }
  return out;
}

export interface ConnectorLabelLayout {
  /** The knockout box in world coordinates, centred on the midpoint. */
  frame: Frame;
  /** Path midpoint the box is centred on. */
  center: Point;
  /** Laid-out text, at `frame.w - 2 * LABEL_PADDING.x` wide. */
  layout: DocumentLayout;
}

/**
 * Lay out `connector`'s label with `measurer` and place it on the path
 * midpoint. Returns null when there is no visible label.
 *
 * Two layout passes: the first wraps at {@link LABEL_MAX_WIDTH} to find
 * the widest line, the second lays out at exactly that width so the box
 * hugs the text whatever the paragraph alignment.
 */
export function placeConnectorLabel(
  connector: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
  measurer: TextMeasurer,
  fontScale = 1,
): ConnectorLabelLayout | null {
  if (isLabelEmpty(connector.label)) return null;
  const blocks = prepareLabelBlocks(connector.label!.blocks, fontScale);
  const wrapped = computeLayout(blocks, measurer, LABEL_MAX_WIDTH).layout;
  const contentW = Math.min(LABEL_MAX_WIDTH, Math.ceil(widestLine(wrapped)));
  const layout =
    contentW === LABEL_MAX_WIDTH
      ? wrapped
      : computeLayout(blocks, measurer, contentW).layout;
  const w = contentW + LABEL_PADDING.x * 2;
  const h = layout.totalHeight + LABEL_PADDING.y * 2;
  const center = pathMidpoint(buildConnectorPath(connector, elements));
  return {
    frame: { x: center.x - w / 2, y: center.y - h / 2, w, h, rotation: 0 },
    center,
    layout,
  };
}

function prepareLabelBlocks(blocks: Block[], fontScale: number): Block[] {
  const normalized = blocks.map((b) => ({ ...b, style: normalizeBlockStyle(b.style) }));
  return fontScale !== 1 ? scaleBlocks(normalized, fontScale) : normalized;
}

function widestLine(layout: DocumentLayout): number {
  let max = 0;
  for (const block of layout.blocks) {
    for (const line of block.lines) max = Math.max(max, line.width);
  }
  return max;
}
