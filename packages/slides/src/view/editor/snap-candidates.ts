import type { Frame, GroupElement } from '../../model/element';
import type { Slide } from '../../model/presentation';
import { boundingBox } from '../../model/frame';
import {
  applyGroupTransform,
  findElementPath,
} from '../../model/group';

/**
 * Collect snap-candidate bboxes for a drag inside `slide` at the given
 * selection scope. `scope` is the ancestor group id chain (outer → inner;
 * empty array = slide root). `excludeIds` are the elements currently
 * being dragged (their own bboxes are not snap candidates).
 *
 * Returned frames are in world coordinates. Rotated elements contribute
 * their **rotated AABB** rather than their unrotated frame, so the snap
 * engine's axis-aligned edge math lines up with what the user sees.
 *
 * At slide-root scope (`scope: []`), a group is a single candidate whose
 * AABB is the group's own rotated bbox — children are NOT exposed.
 *
 * When `scope` is non-empty, the function walks into the innermost group
 * named by `scope[scope.length - 1]` and returns each direct child's
 * world-frame rotated AABB. Frames are composed through all ancestor
 * group transforms so they are in world coordinates. This is the
 * drill-in variant used by Task 9 (drag inside a group).
 */
export function collectSnapCandidates(
  slide: Slide,
  scope: string[],
  excludeIds: ReadonlySet<string>,
): Frame[] {
  if (scope.length === 0) {
    return collectRootCandidates(slide, excludeIds);
  }
  return collectScopedCandidates(slide, scope, excludeIds);
}

/**
 * Root-scope: each element at `slide.elements` is one candidate.
 * Groups count as a single entry (their children are not exposed here).
 * Rotated elements contribute their axis-aligned rotated AABB.
 */
function collectRootCandidates(
  slide: Slide,
  excludeIds: ReadonlySet<string>,
): Frame[] {
  const result: Frame[] = [];
  for (const el of slide.elements) {
    if (excludeIds.has(el.id)) continue;
    result.push(toAABB(el.frame));
  }
  return result;
}

/**
 * Drill-in scope: walk the element tree to find the innermost group in
 * `scope` (last id). Compose all ancestor transforms so child frames
 * are in world coordinates, then emit each direct child's rotated AABB.
 *
 * Throws when the scope group cannot be resolved so callers get a clear
 * error instead of silently producing no candidates.
 */
function collectScopedCandidates(
  slide: Slide,
  scope: string[],
  excludeIds: ReadonlySet<string>,
): Frame[] {
  const innermostId = scope[scope.length - 1];
  const path = findElementPath(slide.elements, innermostId);
  if (!path || path.length === 0) {
    throw new Error(
      `collectSnapCandidates: scope group "${innermostId}" not found on slide "${slide.id}"`,
    );
  }
  const innermostEl = path[path.length - 1];
  if (innermostEl.type !== 'group') {
    throw new Error(
      `collectSnapCandidates: scope element "${innermostId}" is not a group`,
    );
  }

  const scopeGroup = innermostEl as GroupElement;

  // fullAncestors = [outerGroup, ..., scopeGroup]. applyGroupTransform maps a
  // frame from one group's local space to its parent's space, so we apply
  // transforms from the innermost (scopeGroup) outward to reach world coords.
  const fullAncestors = [...path.slice(0, -1), scopeGroup] as GroupElement[];

  const result: Frame[] = [];
  for (const child of scopeGroup.data.children) {
    if (excludeIds.has(child.id)) continue;
    // Walk the ancestor chain inside-out: scopeGroup first, then its ancestors.
    let worldFrame = child.frame;
    for (let i = fullAncestors.length - 1; i >= 0; i--) {
      worldFrame = applyGroupTransform(worldFrame, fullAncestors[i]);
    }
    result.push(toAABB(worldFrame));
  }
  return result;
}

/**
 * Convert a (possibly rotated) frame to its axis-aligned bounding box.
 * The returned frame has `rotation: 0` so the snap engine's edge math
 * works against what the user actually sees on screen.
 *
 * Delegates to `boundingBox` from model/frame.ts, which is already the
 * canonical rotated-AABB computation used across the codebase.
 */
function toAABB(frame: Frame): Frame {
  const { x, y, w, h } = boundingBox(frame);
  return { x, y, w, h, rotation: 0 };
}
