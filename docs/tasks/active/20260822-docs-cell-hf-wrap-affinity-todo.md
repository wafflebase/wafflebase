# Docs: cell / header-footer hit-tests produce wrap affinity (#934)

## Problem

Every path that places a caret inside a table cell or a header/footer
resolves a soft-wrap boundary as `'backward'`, so it can never express
"the start of the next visual line":

- `resolveOffsetInCell` / `resolveOffsetInCellAtXY` (and the nested-table
  recursion behind them) return no affinity, and the in-cell click passes
  none to `cursor.moveTo`; the same-cell drag rebuilds the position
  without it.
- `getHFPositionFromMouse` / `resolveHFCellOffset` return a literal
  `'backward'`.
- `getWrapAffinity` looks the block up in `getLayout()` — the body layout
  only — so cell-inner and header/footer blocks fall through to
  `'backward'` after typing wraps a line.

Consequence: clicking the left edge of a soft-wrapped line inside a cell
or a header draws the caret at the end of the line *above*, and since #67
Home / End / Cmd+Backspace act on that same wrong line. It also blocks the
cell half of #66 — `selection.ts` consumes endpoint affinity in its
cell-internal branch, but no cell endpoint ever carries one.

Pre-existing; #931 only makes it more visible.

## Approach

The body path is correct because `find-position-at-pixel.ts` computes
`affinityForOffset` from the line it hit-tested. Lift that one rule into a
shared helper and apply it at every hit-test that resolves a line:

`hitTestLineAffinity(offset, lineStartOffset, isFirstLineOfBlock)` in
`view/visual-line.ts` — `'forward'` when the offset lands exactly on the
start boundary of a line that is not the block's first, else `'backward'`.

`getWrapAffinity` is rewritten as the issue suggests, on top of #931's own
`getVisualLineRange`, which already consults the **active** layout
(body / header / footer) and already understands cell blocks:

```ts
const [start] = this.getVisualLineRange(pos, 'forward');
return start === pos.offset && start > 0 ? 'forward' : 'backward';
```

## Steps

- [x] `view/visual-line.ts`: add `hitTestLineAffinity`.
- [x] `view/find-position-at-pixel.ts`: `affinityForOffset` delegates to it
      (single source of the rule; behavior unchanged).
- [x] `view/text-editor.ts`: `resolveOffsetInCellAtXY`,
      `resolveOffsetInNestedTable` and `resolveOffsetInCell` return
      `lineAffinity`.
- [x] `view/text-editor.ts`: in-cell single click and shift+click move the
      caret with that affinity and put it on the selection endpoint; the
      same-cell drag rebuild carries it too.
- [x] `view/text-editor.ts`: `getHFPositionFromMouse` /
      `resolveHFCellOffset` compute the affinity instead of returning a
      literal `'backward'`.
- [x] `view/text-editor.ts`: `getWrapAffinity` via `getVisualLineRange`.
- [x] Unit tests for `hitTestLineAffinity` and for the header/footer +
      cell hit-test affinity through the exported layout helpers.
- [x] `getVisualLineRange`'s cell branch resolves the table through
      `resolveNestedTableLayout` (nested cells could only answer 'backward',
      and End did not move there at all) and reads every lookup optionally,
      so the per-keystroke `getWrapAffinity` cannot throw on a stale
      `blockParentMap`.
- [x] Click-path tests: mousedown at the start of a wrapped line in a body
      cell, a nested cell and the header asserts `'forward'` on the caret
      (plus a control click one glyph in asserting `'backward'`), and a
      footer typing test.
- [x] Record where affinity is *produced* in
      `docs/design/docs/docs-local-caret-anchoring.md`.

## Non-goals

- Any change to caret *rendering*: `peer-cursor.ts` already resolves cell
  and header/footer affinity, it was simply never handed a `'forward'`.
- Vertical (up/down) navigation inside header/footer, still unsupported.
- The block-level halves of #66 / #67 — already shipped in #930 / #931.
