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
 * Child position is then: `offset + (child_local - chOff) * (ext / chExt)`.
 *
 * Because both halves are EMU-linear, applying the same scale formula
 * directly on the px values yields the correct world px frame.
 */
export interface GroupTransform {
  parentOffX: number;
  parentOffY: number;
  scaleX: number;
  scaleY: number;
  childBaseX: number;
  childBaseY: number;
  /** Group rotation in radians, applied additively to each child. */
  rotation: number;
}

export const IDENTITY_TRANSFORM: GroupTransform = {
  parentOffX: 0,
  parentOffY: 0,
  scaleX: 1,
  scaleY: 1,
  childBaseX: 0,
  childBaseY: 0,
  rotation: 0,
};

/**
 * Build the cumulative transform for descending into a `<p:grpSp>`.
 * Composes with the parent transform so nested groups (depth > 1) work
 * — the benchmark deck stays at depth 1 but the formula generalises.
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
  // Synthesise a tiny <a:xfrm> for chOff/chExt — parseXfrm wants
  // off/ext children, so we reuse the same helper by writing the same
  // pattern. Simpler: read directly.
  const chOffX = chOffEl ? Number(chOffEl.getAttribute('x') ?? '0') * scale.sx : 0;
  const chOffY = chOffEl ? Number(chOffEl.getAttribute('y') ?? '0') * scale.sy : 0;
  const chExtW = chExtEl ? Number(chExtEl.getAttribute('cx') ?? '0') * scale.sx : off.w;
  const chExtH = chExtEl ? Number(chExtEl.getAttribute('cy') ?? '0') * scale.sy : off.h;

  // Local scale factors: how the local space stretches onto the parent
  // space. When `chExt` matches `ext` (most common), this is identity.
  const localSx = chExtW > 0 ? off.w / chExtW : 1;
  const localSy = chExtH > 0 ? off.h / chExtH : 1;

  // Apply parent transform on top of the local transform so the
  // resulting transform takes a *local child frame* and outputs the
  // *parent's world frame*.
  return {
    parentOffX: parent.parentOffX + (off.x - parent.childBaseX) * parent.scaleX,
    parentOffY: parent.parentOffY + (off.y - parent.childBaseY) * parent.scaleY,
    scaleX: parent.scaleX * localSx,
    scaleY: parent.scaleY * localSy,
    childBaseX: chOffX,
    childBaseY: chOffY,
    rotation: parent.rotation + off.rotation,
  };
}

/** Apply a group transform to a child's local frame, returning the world frame. */
export function applyGroupTransform(frame: Frame, t: GroupTransform): Frame {
  return {
    x: t.parentOffX + (frame.x - t.childBaseX) * t.scaleX,
    y: t.parentOffY + (frame.y - t.childBaseY) * t.scaleY,
    w: frame.w * t.scaleX,
    h: frame.h * t.scaleY,
    rotation: frame.rotation + t.rotation,
  };
}
