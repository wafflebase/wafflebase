---
title: board-sections
target-version: 0.6.16
---

# Board Sections

## Summary

A section is FigJam's Shift+S: a titled region that clusters what is
inside it. Drag the section and its contents come along; rename it from its
title; hide its contents for a reveal, or lock it so a busy workshop cannot
knock it out of place. The third-pass audit
([board-figjam-parity.md](board-figjam-parity.md)) found it to be the
largest brainstorming gap: there was no way to title a cluster of stickies
or move it as one.

The roadmap's open question was "a new element type, or a group with a title
and a frame". This design answers **neither**. A section is an ordinary
`rect` shape carrying an additive `data.section` marker, and membership is
**geometric**: an element belongs to a section when its bounding box lies
mostly inside the section's. Nothing about membership is stored.

### Goals

- Shift+S and a toolbar tool draw a section; a click makes a default-size
  one; "Create section around selection" wraps what is selected.
- Moving a section moves its contents in the same undo step. Resizing it
  changes what it contains, and moves nothing.
- Delete removes the section only. "Delete section and contents" removes
  both.
- Hide covers the contents for everyone; Lock makes the section and its
  contents ignore clicks until unlocked.
- A sections list frames a section; Fit to selection (Shift+2) frames one.
- The Miro importer's `frame` becomes a section.
- Slides behaves exactly as before.

### Non-Goals

- Moving contents in or out by **CRDT** membership (a stored child list).
- Sections inside groups, or groups acting as sections.
- Copy/duplicate of a section carrying its contents (duplicate copies the
  section alone this pass).
- Exporting a section on its own (roadmap Phase 6).
- Per-user hide ("hidden from everyone but me"): hiding is document state.

## Proposal Details

### Data model

```ts
// A section is a ShapeElement:
{
  type: 'shape',
  frame,                                   // rotation always 0
  data: {
    kind: 'rect',
    fill: { kind: 'srgb', value: '#F4F4F5' },     // palette tint
    stroke: { color: '#71717A', width: 2 },       // palette border/title
    section: { title: string, hidden?: true, locked?: true },
  },
}
```

`sectionOf(el)` (`packages/board/src/model/section.ts`) reads the marker; a
marker without a string `title` is not a section. The palette
(`SECTION_COLORS`, six light tints each paired with a border dark enough to
carry white title text) is identified by fill, so a recoloured section needs
no extra field.

Why a marked shape and not a new element kind:

- The shared renderer, hit-test, store, clipboard, PDF/PPTX export and the
  minimap already handle a filled `rect`. A new kind would touch every one
  of them, in Slides' engine, for a board-only object.
- An older client that knows nothing of sections sees a tinted rectangle
  and keeps working. A board without any section is unchanged, and no
  `YorkieBoardRoot` field is added.

Why geometric membership and not a group or a child list:

- A group carries its children in group-local coordinates and selects as a
  unit (`slides/slides-group.md`). A section's contents must stay directly
  selectable, which is the whole point of a brainstorming cluster.
- A stored child list is a second source of truth beside the frames. Two
  peers dragging the same sticky in and out at once would need it
  reconciled; geometry cannot disagree with itself.

The membership rule (`isMostlyInside`): at least half
(`MEMBERSHIP_RATIO`) of an element's axis-aligned bounding box lies inside
the section's. Half means a sticky straddling a border belongs to the side
holding most of it, so it is never claimed by two sibling sections at once.
A degenerate box (a horizontal line) uses its centre. A nested section is a
member only if it is smaller than the outer one, so a larger section that
mostly overlaps a smaller one is its parent, not its child.

### Z-order

Sections render behind everything else: `sectionInsertIndex` puts a new
section behind every ordinary element and behind smaller sections, so a
section drawn around another reads as its parent. Miro frames are emitted
largest first for the same reason.

`YorkieBoardStore.addElementAt(init, index)` inserts at that index in one
array insert. An `addElement` followed by `reorderElement` in the same batch
would be the obvious way, and it is wrong: Yorkie's undo of that change
(a push, then the move's delete and re-insert) leaves the moved element
behind, so a section survived its own undo. That was found by the
`createSection` undo test.

### Editor host options

Board behaviour enters through `initializeEditor` options. Each defaults to
today's Slides behaviour when omitted.

| Option | Used for | Slides default |
| --- | --- | --- |
| `getCompanionMoveIds(movedIds, slide)` | A drag or arrow nudge of a section also moves its members, in the same batch (one undo). Root scope only. Companions that are also unselectable (a hidden section's contents) move without a ghost, so a drag cannot reveal them. | nothing else moves |
| `getUnselectableIds(slide)` | Hit-test, hover, lasso and Mod+A pass over a locked section and its contents, and over a hidden section's contents. | everything selectable |
| `filterLassoSelection(ids, slide, rect)` | A lasso picks a section only when it encloses all of it, so lassoing stickies inside a section does not grab the section too (FigJam's rule). | bbox intersection |
| `interceptTextEdit(el, initialText?)` | Double-click, Enter/F2 and type-to-edit on a section rename it (the typed key seeds the title) instead of mounting shape text. | text edit mounts |
| `hostElementMenuItems(selectedIds)` | Section menu: Rename, Hide/Reveal contents, Lock, Delete section and contents; "Create section around selection" for any top-level selection. | nothing appended |
| `hostCanvasMenuItems(at)` | Now receives the clicked point: "Unlock “title”" for locked sections under it. | (existing, unchanged) |
| `paintAfterElements(ctx, slide, doc)` (renderer) | Title pills and hidden covers, after the elements and before drag ghosts. | no extra pass |

### Interaction

- **Tool.** Shift+S (tool keys fire only with nothing selected, so Google
  type-to-edit wins on a selection), or the toolbar's Section toggle. The
  board's capture-phase `pointerdown` claims a drag on the scene while the
  tool is armed, after the pan claim, so Space / middle-drag still pan. A
  drag draws the rect; a press under 4 screen px makes an 800 × 560 section
  centred on it. The tool disarms, the section is selected, and the title
  input opens. The section tool, the hand and insert modes are mutually
  exclusive.
- **Wrap.** The element menu's "Create section around selection" pads the
  selection's bounds by 48 world px.
- **Move / resize / delete.** Move carries members via
  `getCompanionMoveIds`; members are read at drag start. Resize is the
  shape resize, so it moves nothing and membership follows the new bounds.
  Delete is the shape delete: the contents stay.
- **Rename.** A DOM `<input>` over the title pill (`titleRect`). Enter or
  blur commits, Escape cancels. Its `keydown` stops propagation, so neither
  the board's tool keys nor the editor's key rules see the typing.
- **Hide.** The section paints an opaque cover over its bounds (fill,
  hatching, border, "N hidden items"). Its contents become unselectable;
  the section stays selectable so it can be revealed. The minimap paints
  the cover too.
- **Lock.** The section and its contents become unselectable, so a click
  falls through to the canvas. Unlock is offered in the empty-canvas menu
  for locked sections under the pointer.
- **Navigation.** The toolbar's Sections list, in reading order, frames the
  picked section (and selects it unless it is locked). Shift+2 frames a
  selected section like any element.

### Rendering

The title is a pill inside the section's top-left corner, 12 px text in a
22 px pill at a constant **screen** size: world lengths are screen lengths
divided by the zoom. It is truncated with an ellipsis to the section's
width, and omitted when the section is too small on screen to carry it. The
pill appends the state ("· Locked", "· Hidden"). A section inside a hidden
one is covered with the rest of the contents, title included.

### Miro import

`frame` items become sections with the decoded title (Miro sends frame
titles HTML-escaped). An untitled frame gets "Section". This replaces the
previous best-effort white rectangle whose title was shape text.

### Code map

| Piece | Where |
| --- | --- |
| Model rules (membership, companions, unselectable, lasso, z-order, palette) | `packages/board/src/model/section.ts` |
| Miro `frame` → section | `packages/board/src/import/miro/map-items.ts` |
| Editor host options, store actions, tool gesture, rename input | `packages/frontend/src/app/board/board-sections.ts` |
| Title pill + hidden cover | `packages/frontend/src/app/board/board-section-paint.ts` |
| Section tool, Sections list, section controls | `packages/frontend/src/app/board/board-section-toolbar.tsx` |
| One-insert z-ordered add | `YorkieBoardStore.addElementAt` |

## Risks and Mitigation

- **Geometric membership surprises.** A sticky dropped mostly inside a
  section joins it, including a locked or hidden one, where it then becomes
  unselectable. *Mitigation:* the lock and hide states show on the title
  pill, the canvas menu unlocks a locked section under the pointer, and a
  hidden section stays selectable for Reveal.
- **Membership is read at drag start.** Two peers moving a section and a
  sticky into it at the same time can leave the sticky behind. The frames
  converge either way; nothing is lost.
- **Meta is one LWW object.** `data.section` is replaced whole, so a
  concurrent rename and hide by two peers keeps only one of them. Splitting
  it into per-field keys is the fix if this bites.
- **Marquee inside a section.** A drag that starts on a section's empty area
  moves the section (it is a filled shape). Lassoing items inside a section
  starts from outside it, as in FigJam.
- **Performance.** `getUnselectableIds` runs on every hover sample; it is
  cached per slide object, which the board store keeps stable between
  changes. Membership is O(sections × elements) per computation.
- **Shared engine.** Every new option is additive and omitted on Slides.
  The one deliberate behaviour of the options — unselectable companions
  move without a ghost — only exists when a host supplies both options.
