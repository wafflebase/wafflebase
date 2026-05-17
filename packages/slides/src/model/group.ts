import type { Element, Frame, GroupElement } from './element';
import { applyGroupTransform as applyMatrix } from '../import/pptx/group';
import type { GroupTransform } from '../import/pptx/group';

/**
 * Build the affine transform that maps group-local coords to the
 * parent (world) space.  Children live in (0..w × 0..h) so the
 * scale is identity; the transform is a rotation around the group's
 * world-space centre followed by translation of the group origin.
 */
export function groupToTransform(group: GroupElement): GroupTransform {
  const { x, y, w, h, rotation } = group.frame;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const cx = x + w / 2;
  const cy = y + h / 2;
  return {
    a: cos, b: sin,
    c: -sin, d: cos,
    tx: x + (cx - x) * (1 - cos) + (cy - y) * sin,
    ty: y + (cy - y) * (1 - cos) - (cx - x) * sin,
    rotation,
  };
}

/** Compose: child's group-local frame → world frame in the group's parent space. */
export function applyGroupTransform(child: Frame, group: GroupElement): Frame {
  return applyMatrix(child, groupToTransform(group));
}

/** Inverse: child's world frame → group-local frame. */
export function normalizeToGroupLocal(world: Frame, group: GroupElement): Frame {
  const t = groupToTransform(group);
  const det = t.a * t.d - t.b * t.c; // = 1 for pure rotation
  const inv: GroupTransform = {
    a: t.d / det, b: -t.b / det,
    c: -t.c / det, d: t.a / det,
    tx: -(t.d * t.tx - t.c * t.ty) / det,
    ty: (t.b * t.tx - t.a * t.ty) / det,
    rotation: -t.rotation,
  };
  return applyMatrix(world, inv);
}

/** Walk slide.elements DFS; return the chain from slide-root → element (leaf last). */
export function findElementPath(
  elements: Element[],
  elementId: string,
): Element[] | null {
  for (const el of elements) {
    if (el.id === elementId) return [el];
    if (el.type === 'group') {
      const sub = findElementPath(el.data.children, elementId);
      if (sub) return [el, ...sub];
    }
  }
  return null;
}

/**
 * Returns true if `candidateAncestor.id === target.id` (self) or
 * `target` is nested inside `candidateAncestor`'s `children` tree.
 * Used exclusively for cycle prevention in `store.group()`: checks
 * whether a candidate *group* would land inside the source group.
 */
export function isGroupDescendantOf(
  candidateAncestor: GroupElement,
  target: GroupElement,
): boolean {
  if (candidateAncestor.id === target.id) return true;
  for (const child of candidateAncestor.data.children) {
    if (child.type === 'group' && isGroupDescendantOf(child, target)) return true;
  }
  return false;
}
