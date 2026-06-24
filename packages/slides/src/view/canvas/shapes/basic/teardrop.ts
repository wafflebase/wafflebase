import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { adj } from '../builder';
import { DEFAULT_ARC_SEGMENTS, polylineArc } from '../curves';
import { insetAlongAxis } from '../handles';

/**
 * `teardrop` — an ellipse whose top-right quadrant is pulled out into a
 * point toward the upper-right corner, matching ECMA-376 OOXML geometry.
 *
 * OOXML guides (decoded at w=h=ss=100, default adj=100000):
 *   - tw = wd2·√2, th = hd2·√2; sw = tw·a/100000, sh = th·a/100000
 *   - dx1 = sw·cos45°, dy1 = sh·sin45°
 *   - tip (x1,y1) = (hc + dx1, vc − dy1)  → (100, 0) = top-right corner
 *   - control points x2 = (hc+x1)/2, y2 = (vc+y1)/2
 *
 * Path: upper-left quarter ellipse (left → top-center), quad curve out to
 * the tip, quad curve back to the right point, then lower-right and
 * lower-left quarter ellipses back to the left point. At `adj = 0` the tip
 * collapses onto the ellipse so the shape is a plain ellipse; at
 * `adj = 100000` the tip reaches the top-right corner.
 */
export const TEARDROP_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Tip extension',
    defaultValue: 100000,
    min: 0,
    max: 200000,
  },
];

const R2 = Math.SQRT2;
const COS45 = Math.cos(Math.PI / 4);
const SIN45 = Math.sin(Math.PI / 4);

export const buildTeardrop: PathBuilder = ({ w, h }, adjustments) => {
  const a = Math.max(
    0,
    Math.min(200000, adj(adjustments, 0, TEARDROP_ADJUSTMENTS[0].defaultValue)),
  );

  const hc = w / 2;
  const vc = h / 2;
  const wd2 = w / 2;
  const hd2 = h / 2;

  // Tip position pulled toward the upper-right corner.
  const tw = wd2 * R2;
  const th = hd2 * R2;
  const sw = (tw * a) / 100000;
  const sh = (th * a) / 100000;
  const dx1 = sw * COS45;
  const dy1 = sh * SIN45;
  const x1 = hc + dx1; // tip x
  const y1 = vc - dy1; // tip y
  const x2 = (hc + x1) / 2;
  const y2 = (vc + y1) / 2;

  const seg = DEFAULT_ARC_SEGMENTS;
  const path = new Path2D();

  // 1. moveTo(l, vc): left point.
  path.moveTo(0, vc);

  // 2. arcTo upper-left quarter ellipse: left (0,vc) → top-center (hc,t).
  //    stAng=180°, swAng=+90°.
  const ul = polylineArc(hc, vc, wd2, hd2, Math.PI, Math.PI * 1.5, seg);
  for (let i = 1; i < ul.length; i++) path.lineTo(ul[i].x, ul[i].y);

  // 3. quadBezTo ctrl(x2,t) end(x1,y1): top-center → tip.
  path.quadraticCurveTo(x2, 0, x1, y1);

  // 4. quadBezTo ctrl(r,y2) end(r,vc): tip → right point.
  path.quadraticCurveTo(w, y2, w, vc);

  // 5. arcTo lower-right quarter ellipse: right (r,vc) → bottom-center.
  //    stAng=0°, swAng=+90°.
  const lr = polylineArc(hc, vc, wd2, hd2, 0, Math.PI * 0.5, seg);
  for (let i = 1; i < lr.length; i++) path.lineTo(lr[i].x, lr[i].y);

  // 6. arcTo lower-left quarter ellipse: bottom-center → left point.
  //    stAng=90°, swAng=+90°.
  const ll = polylineArc(hc, vc, wd2, hd2, Math.PI * 0.5, Math.PI, seg);
  for (let i = 1; i < ll.length; i++) path.lineTo(ll[i].x, ll[i].y);

  path.closePath();
  return path;
};

export const TEARDROP_HANDLES: readonly AdjustmentHandle[] = [
  {
    // OOXML handle moves along the top edge: pos = (x1, t).
    position: ({ w }, adjustments) => {
      const a = adjustments[0] ?? TEARDROP_ADJUSTMENTS[0].defaultValue;
      const tw = (w / 2) * R2;
      const dx1 = ((tw * a) / 100000) * COS45;
      return { x: insetAlongAxis(w / 2 + dx1, w), y: 0 };
    },
    apply: ({ w }, start, pointer) => {
      if (w <= 0) return [...start];
      // x1 = hc + (wd2·√2·a/100000)·cos45 = hc + a·w/200000
      //   ⇒  a = (pointer.x − w/2) · 200000 / w
      const raw = Math.round(((pointer.x - w / 2) * 200000) / w);
      const spec = TEARDROP_ADJUSTMENTS[0];
      const clamped = Math.max(spec.min, Math.min(spec.max, raw));
      const result = [...start];
      result[0] = clamped;
      return result;
    },
  },
];
