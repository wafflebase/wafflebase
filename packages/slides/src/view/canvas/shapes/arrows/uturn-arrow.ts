import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { insetAlongAxis } from '../handles';

/**
 * `uturnArrow` — flat-top U with rounded corners and an arrowhead at
 * the bottom of the right arm. Three adjustments:
 *
 * - `adj1` (shaft thickness, % of `min(w, h)`)
 * - `adj2` (arrowhead length, % of `h`)
 * - `adj3` (outer corner radius, % of `min(w, h)`) — small ⇒ near-
 *   right-angle look, large ⇒ collapses to the v0 semicircular top.
 *
 * `adj4`/`adj5` from OOXML are not modelled yet — PPTX-imported shapes
 * fall through their defaults.
 */
export const UTURN_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 20000, min: 0, max: 40000 },
  { name: 'Head length', defaultValue: 20000, min: 0, max: 50000 },
  // Default 50000 chosen so editor-inserted shapes (saved without an
  // explicit `adj3`) render at the maximum bend radius the clamp will
  // allow, which collapses the two outer corners to a single
  // semicircle on square / portrait aspects — the v0 appearance.
  // OOXML's own default for `adj3` is 25000; PPTX imports carry that
  // value explicitly and get the flat-top look that matches PowerPoint.
  { name: 'Bend radius', defaultValue: 50000, min: 0, max: 50000 },
];

export const buildUturnArrow: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, 20000);
  const a2 = adj(adjustments, 1, 20000);
  const a3 = adj(adjustments, 2, 50000);
  const ss = Math.min(w, h);
  const shaft = (a1 / 100000) * ss;
  const headLen = Math.min((a2 / 100000) * h, h);
  const headHalf = shaft * 0.75;
  // Arm centerlines. The right arm carries the arrowhead, whose right
  // shoulder is flush with the bbox right edge; both arms share the
  // same outer-wall offset so the U is symmetric.
  const rightCx = w - headHalf;
  const leftCx = headHalf;
  const outerLeftX = leftCx - shaft / 2;
  const outerRightX = rightCx + shaft / 2;
  const innerLeftX = leftCx + shaft / 2;
  const innerRightX = rightCx - shaft / 2;
  // Outer corner radius. Clamped so the two outer corners don't
  // overlap horizontally and the bend can't dip into the arrowhead
  // band vertically. When the clamp picks `(outerRightX − outerLeftX) /
  // 2` (i.e. requested radius >= half the arm separation, which is
  // typical for square / portrait shapes with the default `adj3`) the
  // two corners share a centre and the path traces a single semicircle
  // — the v0 appearance. Landscape shapes always trip the
  // `h − headLen` cap, so the flat top appears there instead.
  const bendROuter = Math.max(0, Math.min(
    (a3 / 100000) * ss,
    (outerRightX - outerLeftX) / 2,
    Math.max(0, h - headLen),
  ));
  // Inner corner radius. When the bend is thinner than the shaft we
  // can't fit an inner arc — the inner walls just rise to the inner
  // top y and connect with a flat segment (sharp inner corner).
  const bendRInner = Math.max(0, bendROuter - shaft);
  const innerHasArc = bendRInner > 0;
  const innerWallTopY = innerHasArc ? bendROuter : shaft;
  const innerTopEndX = innerHasArc ? outerLeftX + bendROuter : innerLeftX;

  const path = new Path2D();
  // CW outer, starting from bottom-left of left arm.
  path.moveTo(outerLeftX, h);
  path.lineTo(outerLeftX, bendROuter);
  if (bendROuter > 0) {
    const arc = polylineArc(
      outerLeftX + bendROuter,
      bendROuter,
      bendROuter,
      bendROuter,
      Math.PI,
      1.5 * Math.PI,
      8,
    );
    for (const p of arc) path.lineTo(p.x, p.y);
  }
  // Flat outer top.
  path.lineTo(outerRightX - bendROuter, 0);
  if (bendROuter > 0) {
    const arc = polylineArc(
      outerRightX - bendROuter,
      bendROuter,
      bendROuter,
      bendROuter,
      1.5 * Math.PI,
      2 * Math.PI,
      8,
    );
    for (const p of arc) path.lineTo(p.x, p.y);
  }
  // Down the right arm outer wall to head start.
  path.lineTo(outerRightX, h - headLen);
  // Arrowhead — right shoulder, tip, left shoulder, back to inner wall.
  path.lineTo(w, h - headLen);
  path.lineTo(rightCx, h);
  path.lineTo(rightCx - headHalf, h - headLen);
  path.lineTo(innerRightX, h - headLen);
  // Up the right arm inner wall.
  path.lineTo(innerRightX, innerWallTopY);
  if (innerHasArc) {
    const arc = polylineArc(
      outerRightX - bendROuter,
      bendROuter,
      bendRInner,
      bendRInner,
      2 * Math.PI,
      1.5 * Math.PI,
      8,
    );
    for (const p of arc) path.lineTo(p.x, p.y);
  }
  // Flat inner top at y = shaft (top wall thickness = shaft).
  path.lineTo(innerTopEndX, shaft);
  if (innerHasArc) {
    const arc = polylineArc(
      outerLeftX + bendROuter,
      bendROuter,
      bendRInner,
      bendRInner,
      1.5 * Math.PI,
      Math.PI,
      8,
    );
    for (const p of arc) path.lineTo(p.x, p.y);
  }
  // Down the left arm inner wall.
  path.lineTo(innerLeftX, h);
  path.closePath();
  return path;
};

export const UTURN_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const shaft = ((adjustments[0] ?? 20000) / 100000) * Math.min(w, h);
      return { x: insetAlongAxis(shaft, w), y: h };
    },
    apply: ({ w, h }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const raw = Math.round((x / Math.min(w, h)) * 100000);
      const spec = UTURN_ARROW_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 20000,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[1] ?? 20000) / 100000) * h;
      return { x: insetAlongAxis(w, w), y: insetAlongAxis(h - headLen, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const headLen = Math.max(0, h - y);
      const raw = h > 0 ? Math.round((headLen / h) * 100000) : 0;
      const spec = UTURN_ARROW_ADJUSTMENTS[1];
      return [
        start[0] ?? 20000,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
