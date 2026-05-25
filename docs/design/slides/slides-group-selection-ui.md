---
title: slides-group-selection-ui
target-version: 0.4.3
---

# Slides Group Selection UI — Distinct Overlay for Groups

## Summary

Make the slides editor's selection overlay distinguish three states that
currently look identical: a single object, a selected group, and a child
selected after drilling into a group. Today `view/editor/overlay.ts`
renders one treatment for all three — a `1px solid #3a7` box plus eight
resize handles and a rotate handle — so a grouped pair of shapes is
visually indistinguishable from one shape.

Following the PowerPoint / Google Slides hybrid the user selected:

- **Group selected** → the existing solid box + handles **plus a faint
  dashed outline on each direct member** (PowerPoint-style member
  preview), so the selection reads as "a group containing these parts".
- **Drilled-in child** → the existing solid box + handles on the child
  **plus a faint dashed context box around the enclosing group**
  (Google-Slides-style drill-in context), so it reads as "editing this
  element inside that group".

The change is confined to the overlay rendering layer and the data
`editor.ts` feeds it. Selection state (`view/editor/selection.ts`),
hit-test, and the double-click drill-in / `Esc`-to-pop interaction are
**unchanged** — the existing slides-group drill-in model from
[slides-group.md](./slides-group.md) stays as-is. This is a purely
visual enhancement of that feature.

## Goals / Non-Goals

### Goals

- A selected group is visually distinct from a single selected object.
- A child selected via drill-in is visually distinct from a slide-root
  object, showing which group it belongs to.
- Reuse the world frames the editor already computes
  (`worldTightFrame`, `toWorldFrame`, `applyGroupTransform`); no new
  coordinate math.
- Rotated groups and rotated members render correct outlines.
- No regression to single-object or multi-selection overlays.

### Non-Goals

- **No interaction changes.** Drill-in stays double-click to descend,
  `Esc` to pop. PowerPoint's "single click selects a member when the
  group is already selected" is explicitly out of scope.
- **No hover affordance** — highlighting a member on hover before
  drill-in is deferred.
- **No group badge / icon.** Member outlines already signal "group";
  an extra glyph is unnecessary.
- **No design-system token extraction.** Colors reuse the existing
  `#3a7` accent inline, matching the current overlay code. A shared
  token pass is tracked separately under
  [design-system-unification.md](../design-system-unification.md).
- **No member outlines for multi-selection** — only when exactly one
  selected element is a group.

## Proposal Details

### 1. Visual states

| State | Selection box + handles | Added overlay |
| --- | --- | --- |
| Single object | solid `#3a7`, 8 resize + rotate handles (unchanged) | none |
| Group selected | same solid box + handles on the group's tight world frame | faint dashed outline per **direct** child (no handles) |
| Drilled-in child | same solid box + handles on the child | faint dashed **context box** around the innermost enclosing group (no handles) |

The two added overlays never collide:

- Member outlines render only when the *selected* element is a group.
- The context box renders only when `scope.length > 0` (the user is
  inside a group).

When a group is itself selected while drilled into a parent group (a
group nested one level down), both appear: a context box for the parent
plus member outlines for the selected sub-group. This composition is
correct and needs no special-casing.

### 2. Styling

- **Selection box, handles, rotate handle:** unchanged —
  `1px solid #3a7`, the existing `makeHandle` squares, white rotate dot.
- **Member outline and context box:** a single shared style —
  `1px dashed`, faint accent `rgba(58, 170, 119, 0.5)` (the `#3a7`
  accent at 50% alpha), `pointer-events: none`, **no handles**. They
  share one renderer and one look because they are mutually exclusive
  per element, so the dashed faint rectangle is unambiguous in each
  context.
- **Paint order:** context box first, then member outlines, then the
  existing selection handles on top, so handles are never occluded.
- **Rotation:** rendered with the same CSS `transform: rotate(rad)`
  approach `renderRotatedHandles` already uses, so a rotated group, a
  rotated member, or a rotated context box all align.

### 3. Code changes

Two files. No new modules.

**`view/editor/overlay.ts`**

Extend `OverlayOptions`:

```ts
export interface OverlayOptions {
  // ...existing fields...

  /**
   * World frames of the direct children of a singly-selected group.
   * Rendered as faint dashed, handle-less outlines so the user can see
   * the group's members (PowerPoint-style). Empty / omitted = none.
   */
  memberOutlines?: readonly Frame[];

  /**
   * World frame of the innermost group the user has drilled into.
   * Rendered as a faint dashed, handle-less context box (Google
   * Slides-style). Omitted when not drilled in.
   */
  contextBox?: Frame;
}
```

Add one private helper used for both:

```ts
// Render a handle-less, non-interactive dashed rectangle at a world
// frame. Uses CSS rotate so rotation 0 and rotated frames share a path.
function appendOutline(
  overlay: HTMLDivElement,
  frame: Frame,
  scale: number,
  className: string,
): void
```

In `renderOverlay`, after the permanent-guide block and before the
selection-handle branches:

1. If `options.contextBox`, `appendOutline(..., 'wfb-slides-context-box')`.
2. If `options.memberOutlines`, one `appendOutline(...,
   'wfb-slides-member-outline')` per frame.

The existing connector / rotated / axis-aligned handle branches are
untouched and paint afterward.

**`view/editor/editor.ts` (`repaintOverlay`)**

Compute the two new option values from the current selection + scope
(both already available in the method):

- **`contextBox`** — when `scope.length > 0`, resolve the innermost
  scoped group `g = findElement(slide.elements, scope[scope.length-1])`
  and pass
  `toWorldFrame(worldTightFrame(g).worldFrame, scope.slice(0, -1), slide)`.
  This mirrors how the selected-group box's frame is already derived.
- **`memberOutlines`** — when exactly one element is selected and it is
  a group `g`, map each `c` of `g.data.children` to
  `toWorldFrame(applyGroupTransform(c.frame, g), scope, slide)`.
  `applyGroupTransform` lifts the child's group-local frame into the
  group's parent (scope-level) space; `toWorldFrame` lifts scope-level
  space to world.

No other call site of `renderOverlay` needs the new fields (they
default to "none").

### 4. Edge cases

- **Rotated group / rotated members.** Handled by the existing world
  transforms plus the CSS-rotate outline renderer.
- **Nested group selected while drilled in.** Context box (parent) and
  member outlines (selected sub-group) compose correctly.
- **Multi-selection.** No member outlines; the combined-bbox box +
  handles render as today. Context box still shows if drilled in.
- **Connector as a group member.** Its frame is a derived endpoint
  bbox; outlining it with a faint rectangle is acceptable and matches
  how it already contributes to `combinedBoundingBox`.
- **Group invariant.** A group always has ≥1 child
  ([slides-group.md](./slides-group.md) invariant 1), so
  `memberOutlines` is never empty when present.

## Risks and Mitigation

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Member outlines add DOM nodes on every overlay rebuild for large groups. | Minor repaint cost. | Outlines are plain `<div>`s with `pointer-events: none`; `renderOverlay` already rebuilds `innerHTML` each call and groups are small (typically < 20 members). No diffing needed. |
| Faint dashed style too subtle (or too loud) on some themes. | Poor affordance on light/dark backgrounds. | Color matches the existing `#3a7` accent already validated across themes; tune alpha during the manual smoke if needed. Token-based theming is deferred to design-system-unification. |
| World-frame math for member outlines wrong under rotation/nested scope. | Outlines misaligned with members. | Unit test `repaintOverlay`'s frame computation incl. a rotated-group case; reuse the same `toWorldFrame` / `applyGroupTransform` round-trip already covered by frame-space tests. |
| Existing screenshot baselines shift. | Noisy visual diff. | Regenerate the group scenario baselines in one commit with a clear note; add explicit group-selected and drilled-in baselines. |

## Testing Strategy

**Unit (`view/editor/overlay.test.ts`):**

- Single group selected with `memberOutlines` of length N → N
  `.wfb-slides-member-outline` nodes, each with zero `data-handle`
  descendants and `pointer-events: none`.
- `contextBox` set → exactly one `.wfb-slides-context-box`, dashed, no
  handles.
- Single non-group element → no member outlines, no context box (parity
  with today).
- Multi-selection → no member outlines.

**Editor unit (`view/editor/*.test.ts`):**

- `repaintOverlay` computes correct world frames for `memberOutlines`
  and `contextBox`, including a rotated group and a one-level-nested
  drill-in.

**Visual (`verify:browser:docker`):**

- Extend the existing slides group scenario with two baselines: a
  group-selected frame (member outlines visible) and a drilled-in frame
  (context box + child handles visible).
