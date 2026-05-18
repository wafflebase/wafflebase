---
title: slides-group
target-version: 0.5.0
---

# Slides Group / Ungroup — Nested Element Tree

## Summary

Add a first-class `GroupElement` to the slides element union so users
can group / ungroup elements (Cmd/Ctrl+Alt+G ↔ Cmd/Ctrl+Shift+Alt+G),
PPTX `<p:grpSp>` round-trips without flattening, and the existing
PowerPoint / Google Slides group transform math (`composeGroupTransform`
+ `applyGroupTransform`, already in the codebase) is reused for both
import and runtime rendering. Selection follows Google Slides
drill-in semantics: clicking inside a group selects the outermost
group, a second click (double-click) descends one level, `Esc` pops
back out. The slide element array becomes a recursive tree; renderer,
hit-test, snap, drag/resize/rotate, and PDF export all gain a single
recursion layer over the existing per-element logic.

This document covers v1 of the feature. v1.1 deferrals and out-of-scope
items are listed in [§ Non-Goals](#non-goals).

This change closes the **Group / ungroup** entry tracked under "Future
parity with Google Slides → Tracked for v2" in
[slides.md](./slides.md). Once landed, update both that list and the
matching v2 Non-Goals entry to point here.

### Goals

- One new element type `GroupElement` in the existing
  `text | image | shape | connector` union; same `ElementBase` shape
  (`id`, `frame`, `placeholderRef?`) as siblings.
- Group's own `frame` (x, y, w, h, rotation, flipH, flipV) defines
  the group's transform in its parent space. Children's frames are
  stored in **group-local coordinates** (origin at the group's
  top-left, extents `0..frame.w / 0..frame.h`).
- Nested groups work transparently (data model and all recursion
  paths handle arbitrary depth).
- Google Slides-style **drill-in selection**: outermost-group-first,
  double-click to descend one level, `Esc` to pop out.
- **PPTX import preserves groups** — `<p:grpSp>` becomes
  `GroupElement` (no longer flattened). The existing import transform
  composition logic is reused inverted (compose for paint,
  normalize-to-local for import, bake-to-world for ungroup).
- **PDF export reuses the canvas rendering pipeline** — same recursive
  transform composition, so paint and export results stay identical
  by construction.
- Yorkie collaboration converges on concurrent group / ungroup /
  reorder operations the same way today's element array does
  (`Yorkie.Array` semantics applied to `children` instead of just
  `slide.elements`).

### Non-Goals

- **Group-level visual styling** (group stroke, fill, drop shadow,
  hyperlink at the group level). Deferred to v1.1 — needs new toolbar
  surface and isn't required for the core grouping UX.
- **Cross-group connectors** — connectors whose endpoints reference an
  element on the *other* side of a group boundary cannot be included
  in a group via `Cmd+Alt+G` in v1. The connector stays at the
  slide root (with a toast informing the user). Symmetric handling
  (allow them, transforming endpoint coordinates through the group
  matrix at render time) is v1.1.
- **Auto-grouping on PPTX export.** v1 has no PPTX export. The PDF
  pipeline does not need group preservation in the output (it paints
  the composed result).
- **Migrating historical flattened imports** back into groups. We
  threw away group metadata during the old import; old documents
  remain valid as flat elements. Re-importing the source PPTX is
  required to recover groups.
- **Group-level `data` payloads beyond `children`** (custom group
  metadata, named groups, locking). Out of scope; revisit per
  user request.
- **Drag-and-drop reordering between groups** in the thumbnail-style
  panel of slide elements. v1 group / ungroup is the only structural
  mutation across the boundary.
- **Smart guides specifically anchored to group children while the
  group is selected** — snap still works against the group's world
  bbox in v1; per-child snap is only available in drill-in.

## Proposal Details

### 1. Data Model

```ts
// packages/slides/src/model/element.ts

export type GroupElement = ElementBase & {
  type: 'group';
  data: {
    children: Element[];   // recursive; child frames are in group-local space
  };
};

export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | ConnectorElement
  | GroupElement;
```

**Coordinate convention.**

- `GroupElement.frame` is the group's frame in its parent's space
  (slide root or enclosing group). Same `Frame` shape (`x, y, w, h,
  rotation, flipH?, flipV?`) as every other element.
- For every child `c` of a group `g`, `c.frame` is expressed in `g`'s
  local coordinate system, where the group occupies `(0, 0)` to
  `(g.frame.w, g.frame.h)`. No separate `chOff` / `chExt` fields —
  the local origin is always `(0, 0)` and the local extent is always
  the group's own width / height.
- The child's world position is computed at paint / hit-test time by
  composing the group's transform with the parent transform. Group
  resize and group rotation **do not mutate child frames** — only
  the group's own `frame` changes.

**Resize semantics.** Resizing a group by dragging a corner handle
changes `group.frame.w / h`. Because children live in the group's
local coordinate space and the renderer applies the group transform
on top, children visibly scale proportionally — including text and
its font glyphs — matching Google Slides.

**Invariants** (enforced by `MemSlidesStore` and validated in
`model/migrate.ts`):

1. A group has at least one child. Removing the last child triggers
   automatic ungroup (the group element is removed and any remaining
   structure flattens to the parent).
2. A group cannot contain itself as a descendant. `store.group()`
   rejects sets that would create a cycle.
3. `placeholderRef` is not allowed on `GroupElement`. Placeholders
   represent layout slots and are slide-direct only.
4. Children of a group are siblings of each other only — the parent
   sibling order (z-order) is the array order, identical to the
   existing flat-array rule.

**Helper functions** (`packages/slides/src/model/group.ts`, new):

```ts
// Compose: paint a child whose local frame is `child.frame` inside
// the group whose frame is `group.frame`. Returns the world frame.
applyGroupTransform(childFrame: Frame, group: GroupElement): Frame;

// Inverse of applyGroupTransform — used by PPTX import (world → local)
// after composeGroupTransform produces a flat world frame.
normalizeToGroupLocal(worldFrame: Frame, group: GroupElement): Frame;

// Walk to find an element by id; returns the path from slide root.
findElementPath(elements: Element[], elementId: string): Element[] | null;
```

The existing `composeGroupTransform(parent, grpSpEl, scale)` and
`applyGroupTransform(frame, t: GroupTransform)` in
`packages/slides/src/import/pptx/group.ts` already implement the
rotated / non-uniform-scale case (quadratic solver for visual-bbox
preservation). The new helpers in `model/group.ts` are thin wrappers
that build a `GroupTransform` from a `GroupElement.frame` (translate
by `(x, y)` and rotate by `rotation`; local-space origin
`(0, 0)` and extent `(frame.w, frame.h)` mean the scale component is
identity — children already use the group's local coordinate space).
The quadratic-solver math (`scaleRotatedFrame`) is exercised by the
import path where group scale is non-identity, and by `ungroup()`
when baking child frames back to world space.

### 2. Yorkie Schema

The Yorkie root for a slides document already nests
`root.slides[i].elements: Yorkie.Array<Element>`. Groups extend this
recursion one level:

```
root
└── slides: Yorkie.Array<Slide>
    └── elements: Yorkie.Array<Element>
        └── (type === 'group') data:
            └── children: Yorkie.Array<Element>   ← recursive
```

Concurrent semantics:

- **Group / ungroup operations.** `group()` removes N children from
  the parent array and inserts one new group element holding them;
  `ungroup()` does the inverse. Both run inside a single
  `store.batch` so undo restores the previous structure in one step.
  Two users grouping overlapping selections concurrently converge
  on whichever batch arrives second — the "loser" sees their
  selection update to the resulting group.
- **Reorder.** Moving a child within its group's `children` array uses
  `Yorkie.Array.move`, identical to today's slide-element reorder.
- **Text inside grouped text boxes.** `Yorkie.Tree` lives at
  `children[i].data` for text children unchanged; `withTextElement`
  walks the element path to find the live `Yorkie.Tree` regardless of
  group depth.
- **Presence frames during drag.** The presence `draggingFrame`
  carries the path from slide root (`elementPath: string[]`) so peers
  can locate the moving element without searching the tree.

### 3. Store API

Additions and contract changes to `SlidesStore`
(`packages/slides/src/store/store.ts`):

```ts
interface SlidesStore {
  // — Existing element APIs keep their string elementId signature.
  // Implementations resolve the path via findElementPath internally.
  addElement(slideId, init, parentGroupId?: string): string;
  removeElement(slideId, elementId): void;
  removeElements(slideId, elementIds): void;
  updateElementFrame(slideId, elementId, frame): void;
  updateElementData(slideId, elementId, patch): void;
  reorderElement(slideId, elementId, toIndex): void;

  // — New for grouping —
  group(slideId, elementIds): string;
  //   - All elementIds must share the same parent (slide-root or the
  //     same group). Throws if mixed parents.
  //   - Inserts a new GroupElement at the position of the front-most
  //     selected element; children move into it in their original
  //     z-order; child frames are normalized to group-local coords.
  //   - Returns the new group id.
  //
  ungroup(slideId, groupId): string[];
  //   - Bakes each child's frame through the group transform
  //     (applyGroupTransform) and inserts them at the group's
  //     position in the parent array, in their existing order.
  //   - Removes the group. Returns the ids of the flattened children
  //     for selection restoration.

  // — Existing batch grouping is unchanged. group() / ungroup() each
  //   wrap themselves in a single batch.
}
```

`MemSlidesStore` is the reference implementation; tests cover every
mutation including failure modes (mixed parents, cycle creation,
empty group).

### 4. Selection & Drill-in

```ts
type SlideSelection = {
  scope: ElementID[];   // ancestor group ids, outer → inner; empty = slide root
  ids: ElementID[];     // elements selected at the scope level
};
```

| Input | Behavior |
| --- | --- |
| Click empty canvas | `scope = []`, `ids = []` |
| Click on a slide-root element | `scope = []`, `ids = [el.id]` |
| Click on a child of group G (scope `[]`) | `scope = []`, `ids = [G.id]` (outermost-group select) |
| Click on a deeper descendant (scope `[]`) | `ids = [outermostAncestor.id]` |
| Double-click on a child of G (scope `[]`) | `scope = [G.id]`, `ids = [child.id]` (descend one level) |
| Click on a sibling within drilled-in group | `ids = [sibling.id]` (scope unchanged) |
| Click outside the drilled-in group | `scope = []`, then evaluate the click against the new scope |
| `Esc` | Pop one element off `scope`; clear `ids` |
| Shift+Click | Toggle `ids` within current scope |
| `Cmd/Ctrl+A` | Select every element at the current scope level |
| Drag a selected group | Moves group's `frame.x/y` (children untouched) |
| Drag a selected child of a drilled-in group | Moves the child's local `frame.x/y` |
| Double-click a text child after drill-in | Enter text edit mode on the child (matches GS) |

The selection state machine lives in `view/editor/selection.ts`. Hit
results expose the `ancestorPath` (leaf → root) and the state machine
maps it to a final selection based on the current `scope`.

**Presence broadcast.** Only the leaf-most selected element ids are
broadcast (existing `selectedElementIds` shape preserved). Drill-in
depth is local-only — peers see "this collaborator is editing element
X" without knowing the drilled-in depth.

**Keyboard shortcuts** (catalog entries in
`view/editor/shortcuts-catalog.ts`):

- `Cmd/Ctrl + Alt + G` — group selection
- `Cmd/Ctrl + Shift + Alt + G` — ungroup
- `Esc` — pop scope one level

### 5. Rendering & Hit-Test

**Recursive paint.** `slide-renderer.ts` switches from
`paintElements(ctx, elements)` to `paintElement(ctx, el, parent)`:

```
paintElement(ctx, el, parent = identity):
  localMatrix = parent · selfMatrix(el.frame)
  ctx.save()
  ctx.setTransform(localMatrix)
  if el.type === 'group':
    for child of el.data.children:
      paintElement(ctx, child, localMatrix)
  else:
    elementRenderer.paint(ctx, el)   // unchanged per-type renderer
  ctx.restore()
```

The per-type renderers (text, image, shape, connector) are unchanged
— they already paint in their own local frame. Group adds one
`save/transform/restore` envelope and recurses.

**Hit-test (`view/editor/hit-test.ts`).** Depth-first, front-to-back,
producing the full ancestor path:

```
hitTest(point, elements, parentMatrix) → { elementId, ancestorPath }?
  for el of elements reversed:
    local = inverse(selfMatrix(el)) · inverse(parentMatrix) · point
    if el.type === 'group':
      r = hitTest(point, el.data.children, parentMatrix · selfMatrix(el))
      if r: return { ...r, ancestorPath: [el.id, ...r.ancestorPath] }
    else if pointInElement(local, el):
      return { elementId: el.id, ancestorPath: [el.id] }
```

Inverse-matrix rotation handling reuses `model/frame.ts`'s
`localizePoint` per recursion step.

**Snap (`view/editor/snap.ts`).** Snap engine receives world-bboxes
of candidate elements. The bbox of a group is computed by composing
the group transform with the union of its children's bboxes
recursively. At the slide-root scope this means "the selected group
snaps against other top-level elements"; in drill-in, the snap
engine operates on the selected child's local frame against its
siblings in the same group.

**Align / distribute.** Behaves on the current scope's siblings only.
A group selected at slide-root participates as one unit (its world
bbox is the reference rect); inside drill-in, alignment works on
children within that group.

### 6. Drag / Resize / Rotate

- **Translate.** Same as today; only `frame.x/y` mutates for the
  selected element(s). For a group, that means the group's own
  position changes and children move with it for free.
- **Resize.** For a group: `frame.w/h` change only. Children scale
  proportionally as a side effect of the renderer. For a drilled-in
  child: standard element resize on the child's local frame.
- **Rotate.** For a group: `frame.rotation` changes only. Children's
  rotations stay as authored; the visual rotation composes through
  the renderer.
- **Multi-selection resize across types.** Allowed only inside one
  scope. The union-bbox math (`combinedBoundingBox` in
  `view/editor/align.ts`) already produces a rotation-aware AABB
  over selected frames; it composes with the parent transform of the
  current scope to yield world bbox.

All drags broadcast intermediate frames via presence and commit a
single `store.batch` on `mouseup` — the existing pattern.

### 7. Connectors

ConnectorElements can endpoint-reference other elements by id.
Grouping rules:

1. **Connector + both endpoint targets in the selection.** Connector
   joins the new group. Endpoint refs (element ids) are unchanged
   and resolve correctly at paint time because the renderer is
   already inside the group's transform.
2. **Connector with one endpoint outside the selection.** Connector
   is excluded from the group; it stays at the slide root. The
   editor surfaces a non-blocking toast: "Excluded N connector(s)
   linked outside the group". Cross-group connectors land in v1.1.
3. **Connector with two free (coordinate) endpoints.** Endpoint
   coordinates are normalized to group-local space when joining the
   group, baked back to world space on ungroup.

At paint time, the existing `connector-renderer.ts` resolves
endpoints by id and reads the target's frame. Inside a group, both
the connector and the target share the same local space, so the
renderer already produces correct output without changes.

### 8. PPTX Import

`packages/slides/src/import/pptx/group.ts` currently uses
`composeGroupTransform` to flatten `<p:grpSp>` into world-frame
elements. Under the new model:

- On encountering `<p:grpSp>`, the importer creates a `GroupElement`
  whose `frame` is the group's own `<a:xfrm>` in the parent's
  coordinate space, and recurses into its children.
- Each child's `<a:off>` / `<a:ext>` (already in slide pixels after
  `parseXfrm`) is converted to the group's local coordinate space
  before storage: subtract the group's `<a:chOff>` and divide by the
  local scale (`<a:chExt>` → `(group.frame.w, group.frame.h)`).
  This is the inverse of the matrix the old code applied via
  `applyGroupTransform`; the new helper `normalizeToGroupLocal`
  shares the same quadratic-solver branch for rotated children under
  non-uniform group scale.
- Nested `<p:grpSp>` resolves naturally — the recursion already
  exists in the importer; only the per-frame `apply` call becomes
  the inverse normalize call.
- Unsupported descendants (`<p:cxnSp>` with cross-group endpoints,
  picture types we already fall back on, etc.) follow today's
  behavior of being skipped or flattened with a `report.ts`
  warning.

**Import fidelity invariant.** For any PPTX fixture, the union of
world bboxes produced by the new (group-preserving) import must
equal the union produced by the old (flattening) import within
sub-pixel tolerance. This is enforced by a property test in
`import/pptx/group.test.ts` that runs both code paths against the
existing fixture set.

### 9. PDF Export

`packages/slides/src/export/pdf.ts` currently walks
`slide.elements` flat. It becomes recursive in the same shape as
`paintElement`:

- Each `GroupElement` opens a PDF transform context (translation,
  rotation, scale) and recurses into children.
- Children's existing per-type emit functions are unchanged.
- The `pdf-lib` graphics state stack handles `pushGraphicsState` /
  `popGraphicsState` per group level.
- Text glyph positions remain correct because the existing text
  emit computes positions in local space; the transform stack
  applies the composition.

This keeps paint and export sharing one truth: the same recursion
shape and the same transform composition function.

### 10. Other Integration Points

- **Frontend `YorkieSlidesStore`** (`packages/frontend/src/app/slides/
  yorkie-slides-store.ts`): adds `group` / `ungroup` adapter
  methods, descends into nested `children: Yorkie.Array` when
  applying mutations by element path.
- **CLI** (`packages/cli`): `slides content <id>` continues to dump
  the full JSON shape; nested groups appear naturally. No new CLI
  command in v1.
- **REST API**: no change. The metadata endpoints don't expose
  element-level structure.
- **Frontend context menu** (`view/editor/context-menu.ts`): new
  entries — "Group" (when ≥2 elements at one scope selected),
  "Ungroup" (when a group is selected). Shortcuts displayed inline.
- **Toolbar redesign** (`slides-toolbar-redesign.md`): the Arrange
  dropdown gains Group / Ungroup entries above the existing Align /
  Distribute / Order block. Idle and Text-editing toolbar variants
  do not change.
- **Keyboard shortcuts catalog**
  (`slides-keyboard-shortcuts.md`): three new entries (group,
  ungroup, scope-pop) registered in `shortcuts-catalog.ts`.

### 11. Phasing

Each phase ends with something demoable.

| Phase | Deliverable | Verification |
| --- | --- | --- |
| **P1. Model + store** | `GroupElement` type, transform helpers, `MemSlidesStore.group / ungroup`, cycle / empty-group guards, unit tests | `pnpm slides test` |
| **P2. Recursive renderer + hit-test** | `slide-renderer.ts` / `hit-test.ts` recursion, snap-bbox compose for groups. Selection still always picks the outermost group (no drill-in yet). | Unit tests + standalone HTML harness |
| **P3. Drill-in UX** | `selection.ts` scope state machine, `Esc` to pop, drilled-in resize / rotate, `Cmd+Alt+G` / `Cmd+Shift+Alt+G` shortcuts, context menu, toolbar entries | Vitest interaction tests + manual |
| **P4. Yorkie + multi-user** | `YorkieSlidesStore.group / ungroup` over nested `Yorkie.Array`, presence frames over `elementPath`, concurrency tests | `two-user-slides-yorkie.ts` |
| **P5. PPTX import preservation + PDF export recursion** | `import/pptx/group.ts` switches to group-preserving emit, `export/pdf.ts` recursion, fixture regression for both | Integration + visual PDF check |

Verification gates: end of P1–P3 → `pnpm verify:fast`; end of P4 →
`pnpm verify:integration` (Postgres + Yorkie); end of P5 →
`pnpm verify:browser:docker`.

### 12. Testing Strategy

**Unit** (`packages/slides/src/**/*.test.ts`):

- `model/frame.ts` — round-trip property tests:
  `normalizeToGroupLocal(applyGroupTransform(f, g), g) === f`
  across rotation × non-uniform scale × flip matrices, depth 1–2.
- `model/group.ts` — `group()` / `ungroup()` z-order preservation,
  cycle / empty / mixed-parent failure modes, frame conversion
  correctness.
- `store/memory.ts` — every mutation across group boundaries; one
  `batch` per group / ungroup operation; undo restores prior tree
  shape.
- `view/canvas/slide-renderer.ts` — mock `CanvasRenderingContext2D`
  assertion of `save / setTransform / restore` per group level, and
  correct child paint order.
- `view/editor/hit-test.ts` — hit a leaf inside two nested rotated
  groups; verify `ancestorPath` ordering.
- `view/editor/selection.ts` — drill-in state-machine transitions
  (single / double click, Esc, shift, click outside drilled group).

**Integration** (`packages/frontend/tests/app/slides/`):

- `yorkie-slides-store.test.ts` — `MemSlidesStore` and
  `YorkieSlidesStore` produce identical states for the same
  group / ungroup / nested-child sequence.
- `two-user-slides-yorkie.ts` — two users group overlapping
  selections, ungroup concurrently, move children inside groups;
  states converge with deterministic z-order.

**Visual** (`verify:browser:docker`):

- One scenario covering: rotated group containing a rotated text
  box, drill-in, text edit, ungroup. Screenshot baseline updated.

**PPTX import regression**:

- Fixture set under `packages/slides/test/fixtures/pptx-groups/`
  with nested rotated groups + non-uniform scale. The visual-bbox
  invariant test runs new (preserving) and old (flattening) code
  paths and compares world bboxes per leaf within 0.5 px.

### Known Limitations / Follow-ups

- **PDF export not implemented for slides v1.** The slides `export/`
  directory does not exist yet. When it is added, the recursive emitter
  pattern from §9 (Task 15 in the implementation plan) can be copied
  directly; group transforms compose via `applyGroupTransform` in
  `model/group.ts`, so paint and export will share the same math without
  any group-specific changes to the leaf emitters.

- **`selectAt` dead code in `view/editor/interactions/select.ts`.** This
  helper became unreachable after the Task 9 click-handler rewire that
  moved all hit-test dispatch into `SelectionController`. Remove it in a
  follow-up cleanup pass.

### Risks and Mitigation

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Recursion ripples across renderer, hit-test, snap, align, PDF — large change surface, regression-prone. | Multiple file touches; PR review hard. | Ship P1–P3 with **atomic groups only** (selection always picks the outermost group). Drill-in is added in P3 once recursion is stable. PRs are scoped per phase. |
| IME (Korean composition) inside a text element under nested group transforms could misposition the contenteditable overlay. | Korean input breaks for grouped text. | P3 acceptance includes an explicit manual smoke: 회전된 그룹 안 회전된 텍스트 박스에서 한글 조합·확정·백스페이스. The overlay position uses the same composed matrix as the renderer, so the bug surface is "did you compose the matrix the same way"; covered by a dedicated unit test. |
| Hit-test inaccuracy for rotated nested groups (the inverse-matrix path is easy to get wrong). | "I clicked the shape but nothing happens" reports. | Property tests over `frame.ts` extended to depth 2 with random rotation / scale / position; the same test surfaces produce shared fixtures used by hit-test specs. |
| Connector v1 restriction ("both endpoints in selection") may surprise users grouping a diagram. | UX friction. | Toast wording is explicit and counts excluded connectors; the cross-group connector follow-up (v1.1) is linked in the toast tooltip. |
| Existing screenshot baselines change broadly due to renderer recursion (extra save/restore, transform precision). | Noisy PRs, hard to spot real regressions. | Baseline regeneration is one commit at the end of P2 with a clear note. Visual diffs are reviewed phase-by-phase. |
| PPTX import-preserving path produces slightly different world frames than the flattening path due to floating-point ordering. | Visual regressions on imported decks. | Property test invariant in `§ 8` enforces sub-pixel agreement; flatten path is retained behind a debug flag for one release for direct comparison. |
| Old documents (flat-only) get re-saved against the new schema and a stale reader (older client) misreads them. | Forwards-compat surprise. | The schema is additive: a missing `'group'` element type does not affect flat elements. Yorkie clients on older builds simply ignore unknown `type` values in a graceful render skip (already the existing behavior). The deployment plan rolls renderer updates ahead of any UI that produces groups, so old clients never see a `type: 'group'` they cannot render. |
