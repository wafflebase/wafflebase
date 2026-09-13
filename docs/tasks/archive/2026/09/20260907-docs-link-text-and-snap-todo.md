# Docs links: URL-derived text follows the URL; partial link selection snaps

Issue: #1038

Two link defects that collide at one code point. Part A must land first —
Part B, done naively, gives `insertLink` a phantom selection and bypasses
Part A's branch entirely.

## Part A — a URL-derived display text does not follow the new URL

Editing an existing link's URL updates `href` but leaves the display text
stale when the display text *is* the old URL (⌘K with no selection, and
autolink, both create links whose text equals their href).

- [x] `linkTextFollowsHref(block, run)` beside `findLinkRunAt` in
      `packages/docs/src/view/link-run.ts` — shared so the two editors
      cannot diverge (the reason #580 shared `findLinkRunAt`).
- [x] `editor.ts` caret branch (`insertLink`): wrap in `doc.batch(...)` so
      href-change + text-replace undo as one unit; insert the new URL at
      the run's trailing edge first (so it inherits the run style incl.
      the href just written), delete the old text, re-apply the style,
      then `cursor.moveTo(link.start + url.length)` — not optional, the
      caret can otherwise sit past the end of a shortened run.
- [x] Keep the existing `markDirty(cellInfo ? tableBlockId : block.id)`.
- [x] Add the `setCursorForHistory` call the selection branch has.
- [x] Mirror in `packages/docs/src/view/text-box-editor.ts` (Slides/Board
      have no link UI today, so this is behaviour-neutral there).
- [x] Guard the popover: it deliberately survives the caret leaving the
      link, so Apply after clicking into the body inserted the URL as
      text at the new caret. When edit mode was entered on an existing
      link, require the caret to still be in one.

## Part B — a partially selected hyperlink snaps to the whole link

- [x] `expandRangeForLinks(doc, range)` beside `findLinkRunAt`.
  - [x] Skip `tableCellRange` mode (whole cells; block-local offsets are
        meaningless there).
  - [x] Require the range to be already non-collapsed — the constraint
        that keeps Part A's branch, "Add comment", and ⌘B's decision rule
        intact. Explicitly tested.
  - [x] Strictly-interior offset test (`> run.start && < run.end`), not
        `findLinkRunAt`'s edge-inclusive one, so a selection that merely
        abuts a link does not swallow it.
  - [x] Order endpoints without layout: same block → by offset; different
        blocks → `doc.getBlockIndex()`; unorderable (header/footer or cell
        blocks across blocks) → no snap, rather than a wrong-direction
        expansion that would *shrink* the selection.
- [x] `rawAnchor: DocPosition | null` on `Selection`, set from the
      mousedown position; snap computed from `rawAnchor ?? range.anchor`
      so re-snapping is idempotent and reversible (otherwise the snap is a
      one-way ratchet and the anchor's correct direction — which depends on
      where the focus currently is — cannot be recomputed).
- [x] Wire at store time, not read time: drag update + shift+click extend
      (body and in-cell).
- [x] Keyboard shift+arrow: deliberately do **not** snap — a
      character-granular gesture cannot express an intermediate state if
      each keypress re-snaps. Comment at the call site so the divergence
      from the merged-cell precedent doesn't read as an oversight.

## Accepted consequences (not side effects)

Delete/type-over destroys the whole link; ⌘B/I/U restyles the whole link;
undo and presence bake in the snapped range; comment `quotedText` widens.
These *are* the semantics of "a link is an atomic unit".

## Tests

`packages/docs/test/view/`, following the existing mirrored docs/text-box
pairing:

- [x] `link-run.test.ts` — `linkTextFollowsHref`, `expandRangeForLinks`
      (collapsed guard, abutting, forward == backward, tableCellRange).
- [x] `edit-link-in-place.test.ts` — text === old href follows the new
      URL; customised text preserved; caret position; undo as one unit.
- [x] `text-box-edit-link-in-place.test.ts` — the mirror.
- [x] `table-link.test.ts` — the table-cell variant.
