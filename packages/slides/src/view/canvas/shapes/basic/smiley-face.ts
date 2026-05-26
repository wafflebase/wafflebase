import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { insetAlongAxis } from '../handles';

/**
 * `smileyFace` — round face with two small eye cutouts and a smile
 * curve. `adj1` controls the smile curvature; positive values
 * produce a smile, negative values a frown. V0 single-path
 * approximation: outer face CW, two eye holes CCW, mouth as a thin
 * CCW band. Real OOXML preset uses cubic Béziers for the mouth.
 */
export const SMILEY_FACE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Mouth curvature',
    defaultValue: 4653, // OOXML preset default
    min: -4653,
    max: 4653,
  },
];

export const buildSmileyFace: PathBuilder = ({ w, h }, adjustments) => {
  const a = adj(adjustments, 0, SMILEY_FACE_ADJUSTMENTS[0].defaultValue);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const path = new Path2D();
  // Outer face CW.
  const face = polylineArc(cx, cy, rx, ry, 0, 2 * Math.PI, 32);
  path.moveTo(face[0].x, face[0].y);
  for (let i = 1; i < face.length; i++) path.lineTo(face[i].x, face[i].y);
  path.closePath();
  // Eye holes CCW (small ellipses).
  const eyeR = Math.min(rx, ry) * 0.07;
  const eyeY = cy - ry * 0.25;
  const leftEye = polylineArc(cx - rx * 0.3, eyeY, eyeR, eyeR, 2 * Math.PI, 0, 12);
  path.moveTo(leftEye[0].x, leftEye[0].y);
  for (let i = 1; i < leftEye.length; i++) path.lineTo(leftEye[i].x, leftEye[i].y);
  path.closePath();
  const rightEye = polylineArc(cx + rx * 0.3, eyeY, eyeR, eyeR, 2 * Math.PI, 0, 12);
  path.moveTo(rightEye[0].x, rightEye[0].y);
  for (let i = 1; i < rightEye.length; i++) path.lineTo(rightEye[i].x, rightEye[i].y);
  path.closePath();
  // Mouth — thin curved band approximating a smile/frown. Two
  // polyline arcs offset slightly vertically.
  const mouthCx = cx;
  const mouthCy = cy + ry * 0.2;
  const mouthRx = rx * 0.4;
  const mouthRy = ry * 0.3 * (a / 4653); // signed amplitude
  const thickness = Math.min(rx, ry) * 0.04;
  if (Math.abs(mouthRy) >= thickness) {
    const upper = polylineArc(mouthCx, mouthCy, mouthRx, mouthRy, 0, Math.PI, 12);
    const lower = polylineArc(
      mouthCx,
      mouthCy,
      mouthRx,
      mouthRy - thickness * Math.sign(mouthRy),
      Math.PI,
      0,
      12,
    );
    path.moveTo(upper[0].x, upper[0].y);
    for (let i = 1; i < upper.length; i++) path.lineTo(upper[i].x, upper[i].y);
    for (const p of lower) path.lineTo(p.x, p.y);
    path.closePath();
  }
  return path;
};

export const SMILEY_FACE_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const a = adjustments[0] ?? SMILEY_FACE_ADJUSTMENTS[0].defaultValue;
      const ry = h / 2;
      const cy = h / 2;
      // Mouth peak y = cy + ry * 0.2 + ry * 0.3 * (a / 4653).
      const peakY = cy + ry * 0.2 + ry * 0.3 * (a / 4653);
      return { x: w / 2, y: insetAlongAxis(peakY, h) };
    },
    apply: ({ h }, start, pointer) => {
      const ry = h / 2;
      const cy = h / 2;
      // pointer.y = cy + ry*0.2 + ry*0.3 * (a/4653)
      // → a = 4653 * (pointer.y − cy − ry*0.2) / (ry * 0.3)
      const raw = Math.round(
        (4653 * (pointer.y - cy - ry * 0.2)) / (ry * 0.3),
      );
      const spec = SMILEY_FACE_ADJUSTMENTS[0];
      const clamped = Math.max(spec.min, Math.min(spec.max, raw));
      const result = [...start];
      result[0] = clamped;
      return result;
    },
  },
];
