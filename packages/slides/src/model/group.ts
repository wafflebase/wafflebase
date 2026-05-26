import type { Element, Frame, GroupElement } from './element';
import { applyGroupTransform as applyMatrix } from '../import/pptx/group';
import type { GroupTransform } from '../import/pptx/group';
import { boundingBox } from './frame';

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
 * parent (world) space.
 *
 * Children live in (0..refSize.w × 0..refSize.h). The transform
 * scales them by (frame.w / refSize.w, frame.h / refSize.h) so that
 * resizing the group's frame visibly scales children proportionally —
 * matching OOXML <a:chExt> vs <a:ext> semantics.
 *
 * When `data.refSize` is absent (backward compat), it defaults to
 * { w: frame.w, h: frame.h }, giving scale = 1 — identical to the
 * prior behavior.
 *
 * Matrix construction:
 *   m_scale_translate = scale(scaleX, scaleY) then translate(x, y)
 *   final = rotateAroundCenter(cx, cy, rotation) · m_scale_translate
 */
export function groupToTransform(group: GroupElement): GroupTransform {
  const { x, y, w, h, rotation } = group.frame;
  const refW = group.data.refSize?.w ?? w;
  const refH = group.data.refSize?.h ?? h;
  const scaleX = refW > 0 ? w / refW : 1;
  const scaleY = refH > 0 ? h / refH : 1;

  // Base matrix: scale then translate (no rotation yet).
  // Maps local point P → (P.x * scaleX + x, P.y * scaleY + y).
  let m: GroupTransform = {
    a: scaleX, b: 0,
    c: 0,      d: scaleY,
    tx: x,     ty: y,
    rotation: 0,
  };

  if (rotation !== 0) {
    // Rotate around the group's world center (cx, cy):
    //   R = T(cx,cy) · Rot(θ) · T(-cx,-cy)
    // Then compose:  final = R · m
    const cx = x + w / 2;
    const cy = y + h / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    // R matrix coefficients (rotation around pivot):
    const rTx = cx * (1 - cos) + sin * cy;
    const rTy = cy * (1 - cos) - sin * cx;
    // final = R · m  (outer = R, inner = m)
    m = {
      a:  cos * m.a + (-sin) * m.b,
      b:  sin * m.a +   cos  * m.b,
      c:  cos * m.c + (-sin) * m.d,
      d:  sin * m.c +   cos  * m.d,
      tx: cos * m.tx + (-sin) * m.ty + rTx,
      ty: sin * m.tx +   cos  * m.ty + rTy,
      rotation,
    };
  }

  return m;
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
  if (Math.abs(det) < 1e-9) {
    throw new Error('[slides] cannot invert singular group transform (group frame must have non-zero w and h)');
  }
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
  if (Math.abs(det) < 1e-9) {
    throw new Error('[slides] cannot invert singular group transform (group frame must have non-zero w and h)');
  }
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
 * Recursively map every leaf descendant of `group` into the coordinate
 * space that `accum` maps into. Leaves are everything except `group`
 * children — when a child is itself a group, its own frame is skipped
 * (it's just a coordinate-space anchor) and the recursion descends
 * into its children with a composed transform.
 *
 * `accum` defaults to the group's own self-transform, so the result is
 * in the group's parent space. Pass a non-identity `accum` to render
 * the leaves into a further-up space (e.g. slide-root when the group
 * itself is nested).
 */
function worldLeafFrames(
  group: GroupElement,
  accum: GroupTransform = groupToTransform(group),
): Frame[] {
  const result: Frame[] = [];
  for (const ch of group.data.children) {
    if (ch.type === 'group') {
      result.push(
        ...worldLeafFrames(ch, composeGroupMatrix(accum, groupToTransform(ch))),
      );
    } else {
      result.push(applyMatrix(ch.frame, accum));
    }
  }
  return result;
}

/**
 * AABB of `group`'s visible content in the group's parent space,
 * with `rotation` always 0.
 *
 * @deprecated Prefer `worldTightFrame` for selection-handle rendering —
 * it preserves group rotation so the handles rotate with the group.
 * Kept exported for callers that genuinely want the axis-aligned world
 * bbox (e.g. snap candidates).
 */
export function worldChildrenAABB(group: GroupElement): Frame {
  const frames = worldLeafFrames(group);
  if (frames.length === 0) {
    const bb = boundingBox(group.frame);
    return { x: bb.x, y: bb.y, w: bb.w, h: bb.h, rotation: 0 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of frames) {
    const bb = boundingBox(f);
    if (bb.x < minX) minX = bb.x;
    if (bb.y < minY) minY = bb.y;
    if (bb.x + bb.w > maxX) maxX = bb.x + bb.w;
    if (bb.y + bb.h > maxY) maxY = bb.y + bb.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, rotation: 0 };
}

/**
 * Tight rotation-preserving world frame for a group.
 *
 * Computes the minimum frame (in the group's parent space) that wraps
 * every child's current visual extent, holding `frame.rotation` equal
 * to the group's own rotation. Children's world positions are invariant
 * under this transformation — adjusting the group to use this frame +
 * shifting each child's local frame by the local-AABB offset would
 * leave the rendered output identical.
 *
 * Used by:
 *  - the overlay (so rotated groups show rotated handles even after a
 *    child was moved inside drill-in),
 *  - the store's `refitGroup` (materializing this frame into the stored
 *    state so subsequent interactions read a consistent shape).
 *
 * Math: see comment in body. Returns the group's current frame
 * unchanged when the group has no children (defensive: invariant 1
 * forbids empty groups but we tolerate it during transient store
 * states).
 */
export function worldTightFrame(group: GroupElement): {
  worldFrame: Frame;
  localShift: { x: number; y: number };
  newRefSize: { w: number; h: number };
} {
  if (group.data.children.length === 0) {
    return {
      worldFrame: { ...group.frame },
      localShift: { x: 0, y: 0 },
      newRefSize: group.data.refSize
        ? { ...group.data.refSize }
        : { w: group.frame.w, h: group.frame.h },
    };
  }

  // Axis-aligned AABB of children in GROUP-LOCAL coords. boundingBox
  // accounts for each child's own rotation. Connector free endpoints
  // are extra points in local space that also need to be inside the
  // wrap; include them here so the new frame leaves no endpoint outside
  // the group's rotated extent.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ch of group.data.children) {
    const bb = boundingBox(ch.frame);
    if (bb.x < minX) minX = bb.x;
    if (bb.y < minY) minY = bb.y;
    if (bb.x + bb.w > maxX) maxX = bb.x + bb.w;
    if (bb.y + bb.h > maxY) maxY = bb.y + bb.h;
    if (ch.type === 'connector') {
      for (const ep of [ch.start, ch.end]) {
        if (ep.kind === 'free') {
          if (ep.x < minX) minX = ep.x;
          if (ep.y < minY) minY = ep.y;
          if (ep.x > maxX) maxX = ep.x;
          if (ep.y > maxY) maxY = ep.y;
        }
      }
    }
  }

  const localW = Math.max(maxX - minX, 1);
  const localH = Math.max(maxY - minY, 1);

  const oldRefSize = group.data.refSize ?? {
    w: group.frame.w,
    h: group.frame.h,
  };
  const oldScaleX = oldRefSize.w > 0 ? group.frame.w / oldRefSize.w : 1;
  const oldScaleY = oldRefSize.h > 0 ? group.frame.h / oldRefSize.h : 1;

  // Derivation:
  //   T_old(P_old) = R_θ(S · (P_old − C_old)) + O_old
  //   T_new(P_new) = R_θ(S · (P_new − C_new)) + O_new
  // where P_new = P_old − shift, C_old/C_new are the old/new local
  // centres, S is the old scale, and θ is the group's rotation.
  // For T_new(P_new) = T_old(P_old) (children invariant), it follows
  //   O_new = O_old − R_θ(S · (C_old − shift − C_new)).
  // C_old = (oldRefSize.w/2, oldRefSize.h/2)
  // C_new = (localW/2, localH/2)
  // shift = (minX, minY)
  const dxLocal = oldRefSize.w / 2 - minX - localW / 2;
  const dyLocal = oldRefSize.h / 2 - minY - localH / 2;
  const dxScaled = oldScaleX * dxLocal;
  const dyScaled = oldScaleY * dyLocal;
  const cosT = Math.cos(group.frame.rotation);
  const sinT = Math.sin(group.frame.rotation);
  const dxWorld = dxScaled * cosT - dyScaled * sinT;
  const dyWorld = dxScaled * sinT + dyScaled * cosT;

  const oldCx = group.frame.x + group.frame.w / 2;
  const oldCy = group.frame.y + group.frame.h / 2;
  const newCx = oldCx - dxWorld;
  const newCy = oldCy - dyWorld;

  const newW = localW * oldScaleX;
  const newH = localH * oldScaleY;

  return {
    worldFrame: {
      x: newCx - newW / 2,
      y: newCy - newH / 2,
      w: newW,
      h: newH,
      rotation: group.frame.rotation,
    },
    localShift: { x: minX, y: minY },
    newRefSize: { w: localW, h: localH },
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
