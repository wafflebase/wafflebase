import type { Frame } from '../../model/element';
import type { EmuScale } from './geometry';
import { parseXfrm } from './geometry';
import { child } from './xml';

/**
 * 2D affine transform that maps a child's local frame (in deck-px,
 * already scaled by `parseXfrm`) into the world frame after a group
 * has been "ungrouped" inline.
 *
 *   [a c tx]
 *   [b d ty]   →  world = M · local
 *   [0 0  1]
 *
 * The matrix bakes in every enclosing group's translate / scale /
 * rotation, so nested rotated groups compose correctly via standard
 * matrix multiplication. `rotation` is the cumulative element-self
 * rotation that gets added to each child's own `frame.rotation` (the
 * canvas renderer rotates each element around its own center, so the
 * world-space orbit is handled by the matrix while the in-place spin
 * is handled by `rotation`).
 *
 * OOXML group spPr exposes four boxes:
 *   `<a:off>`   — group position in the parent space
 *   `<a:ext>`   — group size in the parent space
 *   `<a:chOff>` — local origin (subtracted from each child)
 *   `<a:chExt>` — local extent (denominator of the local scale)
 *
 * The group's own transform is composed of (applied to a local point):
 *   1. translate by `-chOff`
 *   2. scale by `ext / chExt`
 *   3. translate by `off`
 *   4. rotate by `rot` around the group's center `off + ext / 2`
 */
export interface GroupTransform {
  a: number; b: number;
  c: number; d: number;
  tx: number; ty: number;
  rotation: number;
}

export const IDENTITY_TRANSFORM: GroupTransform = {
  a: 1, b: 0,
  c: 0, d: 1,
  tx: 0, ty: 0,
  rotation: 0,
};

/**
 * Build the cumulative transform for descending into a `<p:grpSp>` —
 * `parent * group` so the parent applies *after* the group's own
 * transform (i.e., child → group local → parent world).
 */
export function composeGroupTransform(
  parent: GroupTransform,
  grpSp: Element,
  scale: EmuScale,
): GroupTransform {
  const grpSpPr = child(grpSp, 'grpSpPr');
  const xfrm = grpSpPr ? child(grpSpPr, 'xfrm') : undefined;
  if (!xfrm) return parent;

  // Group's own frame in the local px space (already scaled).
  const off = parseXfrm(xfrm, scale);
  const chOffEl = child(xfrm, 'chOff');
  const chExtEl = child(xfrm, 'chExt');
  const chOffX = chOffEl ? Number(chOffEl.getAttribute('x') ?? '0') * scale.sx : 0;
  const chOffY = chOffEl ? Number(chOffEl.getAttribute('y') ?? '0') * scale.sy : 0;
  const chExtW = chExtEl ? Number(chExtEl.getAttribute('cx') ?? '0') * scale.sx : off.w;
  const chExtH = chExtEl ? Number(chExtEl.getAttribute('cy') ?? '0') * scale.sy : off.h;

  const localSx = chExtW > 0 ? off.w / chExtW : 1;
  const localSy = chExtH > 0 ? off.h / chExtH : 1;

  // Matrix for this group: translate(off) · scale(localSx, localSy) · translate(-chOff)
  //   = [localSx  0       off.x - localSx*chOffX]
  //     [0        localSy off.y - localSy*chOffY]
  let m: GroupTransform = {
    a: localSx, b: 0,
    c: 0, d: localSy,
    tx: off.x - localSx * chOffX,
    ty: off.y - localSy * chOffY,
    rotation: 0,
  };

  // Rotate around the group's own center (parent-relative coords).
  if (off.rotation) {
    const pivotX = off.x + off.w / 2;
    const pivotY = off.y + off.h / 2;
    m = composeMatrix(rotationAround(off.rotation, pivotX, pivotY), m);
    m.rotation = off.rotation;
  }

  // Final composition: parent · group.
  const composed = composeMatrix(parent, m);
  composed.rotation = parent.rotation + m.rotation;
  return composed;
}

/**
 * Apply a group transform to a child's local frame, returning the
 * world frame. The element's own rotation is preserved; the group's
 * accumulated rotation is added on top so the renderer's "rotate
 * around own center" maps to the correct visual orientation.
 */
export function applyGroupTransform(frame: Frame, t: GroupTransform): Frame {
  // Apply matrix to the child's center.
  const cxLocal = frame.x + frame.w / 2;
  const cyLocal = frame.y + frame.h / 2;
  const cxWorld = t.a * cxLocal + t.c * cyLocal + t.tx;
  const cyWorld = t.b * cxLocal + t.d * cyLocal + t.ty;

  // Extract scale along each axis. For pure rotation / translation /
  // scale (no shear) this is exact; shear cases (rare in OOXML) will
  // still produce a reasonable approximation.
  const scaleX = Math.sqrt(t.a * t.a + t.b * t.b);
  const scaleY = Math.sqrt(t.c * t.c + t.d * t.d);
  const w = frame.w * scaleX;
  const h = frame.h * scaleY;

  return {
    x: cxWorld - w / 2,
    y: cyWorld - h / 2,
    w,
    h,
    rotation: frame.rotation + t.rotation,
  };
}

/**
 * Apply a group transform to a single point (used for connector
 * free endpoints, which are bare `(x, y)` rather than a full frame).
 */
export function applyGroupTransformToPoint(
  x: number,
  y: number,
  t: GroupTransform,
): { x: number; y: number } {
  return {
    x: t.a * x + t.c * y + t.tx,
    y: t.b * x + t.d * y + t.ty,
  };
}

/** Compose two affine matrices: result = outer · inner (apply inner first). */
function composeMatrix(outer: GroupTransform, inner: GroupTransform): GroupTransform {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
    rotation: outer.rotation,
  };
}

/** R(θ, pivot) = T(pivot) · R(θ) · T(-pivot). */
function rotationAround(theta: number, pivotX: number, pivotY: number): GroupTransform {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    a: cos, b: sin,
    c: -sin, d: cos,
    tx: pivotX * (1 - cos) + sin * pivotY,
    ty: pivotY * (1 - cos) - sin * pivotX,
    rotation: 0,
  };
}
