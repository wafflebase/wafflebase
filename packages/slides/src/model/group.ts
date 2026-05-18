import type { Element, Frame, GroupElement } from './element';
import { applyGroupTransform as applyMatrix } from '../import/pptx/group';
import type { GroupTransform } from '../import/pptx/group';

export type { GroupTransform } from '../import/pptx/group';

/** Identity matrix (no translation, no rotation). */
export const IDENTITY_GROUP_TRANSFORM: GroupTransform = {
  a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0, rotation: 0,
};

/**
 * Compose two transforms: `result = outer · inner` (apply inner first).
 * Accumulates rotation additively so callers that care about the
 * cumulative rotation can read `result.rotation` directly.
 */
export function composeGroupMatrix(
  outer: GroupTransform,
  inner: GroupTransform,
): GroupTransform {
  return {
    a:  outer.a * inner.a + outer.c * inner.b,
    b:  outer.b * inner.a + outer.d * inner.b,
    c:  outer.a * inner.c + outer.c * inner.d,
    d:  outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
    rotation: outer.rotation + inner.rotation,
  };
}

/**
 * Compose the chain of group transforms along an ancestor path. Each
 * entry in `ancestors` is a group element; the resulting matrix maps
 * a point in the innermost group's local space to the outermost
 * parent's space (slide root if `ancestors` starts from a slide-root
 * group).
 */
export function composeAncestorTransform(
  ancestors: GroupElement[],
): GroupTransform {
  let m = IDENTITY_GROUP_TRANSFORM;
  for (const g of ancestors) {
    m = composeGroupMatrix(m, groupToTransform(g));
  }
  return m;
}

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

/**
 * Inverse of applyMatrix(frame, t): given a frame in the world space
 * produced by `t`, return its frame in `t`'s local space. Used by the
 * store when grouping elements whose ancestors are themselves groups.
 */
export function applyInverseMatrix(frame: Frame, t: GroupTransform): Frame {
  const det = t.a * t.d - t.b * t.c;
  const inv: GroupTransform = {
    a:  t.d / det, b: -t.b / det,
    c: -t.c / det, d:  t.a / det,
    tx: -(t.d * t.tx - t.c * t.ty) / det,
    ty:  (t.b * t.tx - t.a * t.ty) / det,
    rotation: -t.rotation,
  };
  return applyMatrix(frame, inv);
}

/** Inverse: child's world frame → group-local frame. */
export function normalizeToGroupLocal(world: Frame, group: GroupElement): Frame {
  return applyInverseMatrix(world, groupToTransform(group));
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

/**
 * Transform a world point `(x, y)` into the local coordinate space of the
 * frame described by `t`. Point-only counterpart of `applyInverseMatrix` —
 * avoids the zero-extent Frame trick and makes the intent explicit.
 *
 * Used by hit-testing (transform world pointer into group-local coords) and
 * by any future operation that needs to invert a group transform for a point
 * rather than a full frame.
 */
export function applyInversePoint(
  x: number,
  y: number,
  t: GroupTransform,
): { x: number; y: number } {
  const det = t.a * t.d - t.b * t.c;
  // Pure rotation/translation matrices always have det === 1; this guard is
  // a safety net for any future shear cases.
  const invA =  t.d / det;
  const invB = -t.b / det;
  const invC = -t.c / det;
  const invD =  t.a / det;
  const invTx = -(t.d * t.tx - t.c * t.ty) / det;
  const invTy =  (t.b * t.tx - t.a * t.ty) / det;
  return {
    x: invA * x + invC * y + invTx,
    y: invB * x + invD * y + invTy,
  };
}

/**
 * DFS walk of an element tree that returns a flat list containing every
 * element at every depth. Used by `slide-renderer.ts` to build an
 * `elementsLookup` that includes elements nested inside groups, so that
 * connector endpoints referencing elements inside groups can resolve
 * correctly.
 */
export function flattenElements(elements: Element[]): Element[] {
  const result: Element[] = [];
  for (const el of elements) {
    result.push(el);
    if (el.type === 'group') {
      result.push(...flattenElements(el.data.children));
    }
  }
  return result;
}
