/**
 * Test-only helpers for the group resting-scale invariant
 * (docs/design/slides/slides-group.md §6.1): after any committed edit,
 * every group at every depth must satisfy `refSize == frame` (scale 1).
 *
 * These live under test/ rather than src/ because nothing in production
 * enforces the invariant at runtime — it is upheld by the commit paths
 * baking on commit. Regression tests use these to assert that.
 */
import type { Element, GroupElement } from '../../src/model/element';

/** True when `group` rests at scale 1 (`refSize` absent or ≈ `frame`). */
export function isGroupSettled(group: GroupElement, eps = 0.01): boolean {
  const ref = group.data.refSize;
  if (!ref) return true; // absent ⇒ defaults to frame ⇒ scale 1.
  return (
    Math.abs(ref.w - group.frame.w) <= eps &&
    Math.abs(ref.h - group.frame.h) <= eps
  );
}

/**
 * Every group in `elements` (all depths) that violates the invariant.
 * Empty array ⇒ the whole tree is settled.
 */
export function collectUnsettledGroups(
  elements: readonly Element[],
  eps = 0.01,
): GroupElement[] {
  const out: GroupElement[] = [];
  const walk = (els: readonly Element[]): void => {
    for (const el of els) {
      if (el.type === 'group') {
        if (!isGroupSettled(el, eps)) out.push(el);
        walk(el.data.children);
      }
    }
  };
  walk(elements);
  return out;
}
