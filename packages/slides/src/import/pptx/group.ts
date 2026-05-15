import type { Frame } from '../../model/element';
import type { EmuScale } from './geometry';
import { parseXfrm } from './geometry';
import { child } from './xml';

/**
 * Affine transform that maps a child's local frame (in deck-px,
 * already scaled by `parseXfrm`) into the world frame after a group
 * has been "ungrouped" inline.
 *
 * OOXML group spPr exposes four boxes:
 *   `<a:off>`   — group's position in the parent space
 *   `<a:ext>`   — group's size in the parent space
 *   `<a:chOff>` — local origin (subtracted from each child)
 *   `<a:chExt>` — local extent (the denominator of the local scale)
 *
 * Child position before rotation is then:
 *   `offset + (child_local - chOff) * (ext / chExt)`
 *
 * Rotation is applied last: each child's *center* is rotated around the
 * group's world center, then the group's rotation is added to the
 * child's own. Nested rotated groups are approximated — inner pivot is
 * computed pre-rotation of the outer (correct when outer rotation = 0,
 * which is the only case the benchmark deck and most real decks hit).
 */
export interface GroupTransform {
  parentOffX: number;
  parentOffY: number;
  scaleX: number;
  scaleY: number;
  childBaseX: number;
  childBaseY: number;
  /** Group rotation in radians, applied around (pivotX, pivotY). */
  rotation: number;
  /** Rotation pivot in world coordinates (group's center). */
  pivotX: number;
  pivotY: number;
}

export const IDENTITY_TRANSFORM: GroupTransform = {
  parentOffX: 0,
  parentOffY: 0,
  scaleX: 1,
  scaleY: 1,
  childBaseX: 0,
  childBaseY: 0,
  rotation: 0,
  pivotX: 0,
  pivotY: 0,
};

/**
 * Build the cumulative transform for descending into a `<p:grpSp>`.
 */
export function composeGroupTransform(
  parent: GroupTransform,
  grpSp: Element,
  scale: EmuScale,
): GroupTransform {
  const grpSpPr = child(grpSp, 'grpSpPr');
  const xfrm = grpSpPr ? child(grpSpPr, 'xfrm') : undefined;
  if (!xfrm) return parent;

  // Read the group's own frame in the local px space (already scaled).
  const off = parseXfrm(xfrm, scale);

  const chOffEl = child(xfrm, 'chOff');
  const chExtEl = child(xfrm, 'chExt');
  const chOffX = chOffEl ? Number(chOffEl.getAttribute('x') ?? '0') * scale.sx : 0;
  const chOffY = chOffEl ? Number(chOffEl.getAttribute('y') ?? '0') * scale.sy : 0;
  const chExtW = chExtEl ? Number(chExtEl.getAttribute('cx') ?? '0') * scale.sx : off.w;
  const chExtH = chExtEl ? Number(chExtEl.getAttribute('cy') ?? '0') * scale.sy : off.h;

  // Local scale factors: how the local space stretches onto the parent
  // space. When `chExt` matches `ext` (most common), this is identity.
  const localSx = chExtW > 0 ? off.w / chExtW : 1;
  const localSy = chExtH > 0 ? off.h / chExtH : 1;

  // Pivot of THIS group in world coordinates = center of the group's
  // own frame after the parent's translate+scale (but ignoring the
  // parent's rotation — see GroupTransform jsdoc).
  const groupCenterX = off.x + off.w / 2;
  const groupCenterY = off.y + off.h / 2;
  const pivotX =
    parent.parentOffX + (groupCenterX - parent.childBaseX) * parent.scaleX;
  const pivotY =
    parent.parentOffY + (groupCenterY - parent.childBaseY) * parent.scaleY;

  return {
    parentOffX: parent.parentOffX + (off.x - parent.childBaseX) * parent.scaleX,
    parentOffY: parent.parentOffY + (off.y - parent.childBaseY) * parent.scaleY,
    scaleX: parent.scaleX * localSx,
    scaleY: parent.scaleY * localSy,
    childBaseX: chOffX,
    childBaseY: chOffY,
    rotation: parent.rotation + off.rotation,
    pivotX,
    pivotY,
  };
}

/**
 * Apply a group transform to a child's local frame, returning the
 * world frame. Non-zero group rotation rotates the child's center
 * around the group's pivot rather than just adding to the child's own
 * rotation in place.
 */
export function applyGroupTransform(frame: Frame, t: GroupTransform): Frame {
  // Pre-rotation world position via affine.
  const x0 = t.parentOffX + (frame.x - t.childBaseX) * t.scaleX;
  const y0 = t.parentOffY + (frame.y - t.childBaseY) * t.scaleY;
  const w = frame.w * t.scaleX;
  const h = frame.h * t.scaleY;

  if (!t.rotation) {
    return { x: x0, y: y0, w, h, rotation: frame.rotation };
  }

  // Rotate the child's center around the group's world pivot, then
  // recover the top-left from the rotated center using the (still
  // axis-aligned in local frame terms) child dimensions.
  const cxLocal = x0 + w / 2;
  const cyLocal = y0 + h / 2;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  const dx = cxLocal - t.pivotX;
  const dy = cyLocal - t.pivotY;
  const cxWorld = t.pivotX + dx * cos - dy * sin;
  const cyWorld = t.pivotY + dx * sin + dy * cos;
  return {
    x: cxWorld - w / 2,
    y: cyWorld - h / 2,
    w,
    h,
    rotation: frame.rotation + t.rotation,
  };
}
