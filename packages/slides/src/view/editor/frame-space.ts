/**
 * frame-space.ts — world ↔ scope-local frame conversions for the editor.
 *
 * WHY this module exists:
 * When the user drills into a group (scope != []), the selected elements'
 * frames are stored in group-local coordinates (the invariant from Task 1).
 * The editor's pointer events work in world (slide-root) coordinates, so
 * every interaction (drag, resize, rotate, nudge) must:
 *
 *   1. Read the stored frame and convert it to world space for display and
 *      delta calculations.
 *   2. Compute the new frame in world space (what the user sees).
 *   3. Convert back to scope-local space before calling
 *      `updateElementFrame()` so the stored data remains consistent.
 *
 * For scope = [] (slide-root elements), the ancestor transform is the
 * identity matrix and both conversions are no-ops, preserving backward
 * compatibility with all existing interaction code.
 */

import type { Frame, GroupElement } from '../../model/element';
import type { Slide } from '../../model/presentation';
import {
  composeAncestorTransform,
  findElementPath,
  applyInverseMatrix,
  IDENTITY_GROUP_TRANSFORM,
} from '../../model/group';
import { applyGroupTransform as applyMatrix } from '../../import/pptx/group';
import type { GroupTransform } from '../../model/group';

export type { GroupTransform };

/**
 * Resolve the combined affine transform that maps a point in the
 * innermost scope group's local space to slide-root (world) space.
 *
 * `scope` is the ordered chain of ancestor group ids (outer → inner)
 * that the user has drilled into via double-click. `scope = []` returns
 * the identity transform.
 *
 * Throws if any id in `scope` is not found on `slide` or is not a group.
 * This is intentional: a stale scope id after a remote mutation is a
 * programming error the caller should guard against.
 */
export function scopeAncestorTransform(
  slide: Slide,
  scope: readonly string[],
): GroupTransform {
  if (scope.length === 0) return IDENTITY_GROUP_TRANSFORM;

  const innermostId = scope[scope.length - 1];
  const path = findElementPath(slide.elements, innermostId);
  if (!path || path.length === 0) {
    throw new Error(
      `frame-space: scope group "${innermostId}" not found on slide "${slide.id}"`,
    );
  }
  const innermostEl = path[path.length - 1];
  if (innermostEl.type !== 'group') {
    throw new Error(
      `frame-space: scope element "${innermostId}" is not a group`,
    );
  }

  // fullAncestors = [outerGroup, ..., scopeGroup].
  // composeAncestorTransform folds the chain into one matrix that maps
  // a point in scopeGroup's local space to world coordinates.
  const fullAncestors = path as GroupElement[];
  return composeAncestorTransform(fullAncestors);
}

/**
 * Convert a frame stored at the scope level (group-local coords when
 * scope is non-empty) into world (slide-root) coordinates.
 *
 * For scope = [] this is an identity operation — world IS local.
 */
export function toWorldFrame(
  frame: Frame,
  scope: readonly string[],
  slide: Slide,
): Frame {
  if (scope.length === 0) return frame;
  const t = scopeAncestorTransform(slide, scope);
  return applyMatrix(frame, t);
}

/**
 * Convert a world-space frame back into the scope's local coordinates.
 * Inverse of `toWorldFrame`.
 *
 * For scope = [] this is an identity operation.
 */
export function fromWorldFrame(
  frame: Frame,
  scope: readonly string[],
  slide: Slide,
): Frame {
  if (scope.length === 0) return frame;
  const t = scopeAncestorTransform(slide, scope);
  return applyInverseMatrix(frame, t);
}
