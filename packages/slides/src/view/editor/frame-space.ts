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
  applyGroupTransform,
  worldTightFrame,
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

  // Validate the entire scope chain: the path's ancestor ids must match
  // the scope array exactly. If any intermediate id is stale (e.g., a
  // remote peer deleted a parent group while the user was drilled in),
  // we catch it here rather than silently miscomputing world↔local transforms.
  const pathIds = path.map((el) => el.id);
  if (
    pathIds.length !== scope.length ||
    !scope.every((id, i) => id === pathIds[i])
  ) {
    throw new Error(
      `frame-space: scope chain mismatch for innermost "${innermostId}" on slide "${slide.id}"`,
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

/**
 * Compute the auxiliary overlay frames that distinguish a group
 * selection from a single object. All frames are returned in world
 * (slide-root) coordinates, ready to be scaled by the host factor in
 * the overlay. Pure: no DOM, no editor state.
 *
 * - `memberOutlines`: world frames of the direct children of a
 *   singly-selected group, so the overlay can outline the group's
 *   members (PowerPoint-style). Empty unless exactly one group is
 *   selected.
 * - `contextBox`: world frame of the innermost group the user has
 *   drilled into, so the overlay can show the enclosing group as
 *   context (Google Slides-style). Undefined unless `scope` is
 *   non-empty and resolves to a group.
 */
export function groupOverlayFrames(
  slide: Slide,
  selectedIds: readonly string[],
  scope: readonly string[],
): { memberOutlines: Frame[]; contextBox: Frame | undefined } {
  let contextBox: Frame | undefined;
  if (scope.length > 0) {
    const innermostId = scope[scope.length - 1];
    const path = findElementPath(slide.elements, innermostId);
    const g = path ? path[path.length - 1] : undefined;
    if (g && g.type === 'group') {
      // worldTightFrame returns a frame in the group's *parent* space
      // (= the scope.slice(0,-1) scope); lift it the rest to world.
      contextBox = toWorldFrame(
        worldTightFrame(g).worldFrame,
        scope.slice(0, -1),
        slide,
      );
    }
  }

  const memberOutlines: Frame[] = [];
  if (selectedIds.length === 1) {
    const path = findElementPath(slide.elements, selectedIds[0]);
    const el = path ? path[path.length - 1] : undefined;
    if (el && el.type === 'group') {
      for (const child of el.data.children) {
        // child.frame is group-local → group's parent (scope) space via
        // applyGroupTransform, then scope space → world via toWorldFrame.
        memberOutlines.push(
          toWorldFrame(applyGroupTransform(child.frame, el), scope, slide),
        );
      }
    }
  }

  return { memberOutlines, contextBox };
}
