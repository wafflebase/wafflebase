# Docs — "Edit link" updates the existing link in place (#494)

## Context

Issue #494: clicking inside an existing hyperlink in Docs and using
"Edit link" → Apply does not update the link. Instead a brand-new link
(the URL as text) is inserted at the caret, leaving the original link
untouched. Dragging to select the link first works — which pins the bug
to `insertLink`'s collapsed-caret branch.

Root cause: `insertLink` has only two branches — selection present
(apply `href` to the range) and collapsed caret (insert the URL as new
linked text). There is no "caret inside an existing link run" case, so
the popover's Apply falls into the insert-new-text branch
(`packages/docs/src/view/editor.ts`, and the same shape duplicated in
`packages/docs/src/view/text-box-editor.ts` which powers Slides text
boxes and Slides table cells).

The run-boundary logic needed for that third branch already exists —
`removeLink` finds the full link run at the caret (cursor inline → walk
`lo`/`hi` across adjacent runs sharing the same `href`) in both editors,
duplicated inline. Same spirit as #495/PR #520, which put its boundary
check in one shared place (`isAtLinkTrailingEdge`, a private method on
the shared `TextEditor` class) — but `insertLink`/`removeLink` live in
the two editor factories (`initialize` / `initializeTextBox`), which
share no class, so the shared home here is a standalone module
(`link-run.ts`), following the `word-boundary.ts` / `url-detect.ts`
view-helper idiom.

One deliberate semantic choice: at the shared boundary between two
*adjacent different-href* links (end of A == start of B), `removeLink`'s
loop used to pick the later run (B), while `getLinkAtCursor` — which
feeds the popover's URL field — reports A. The extracted helper breaks
the tie toward the earlier run (first match) so that what the popover
*shows* is what Apply *updates*; `removeLink` inherits the same
tie-break, a strict consistency improvement.

## Work

- [x] Extract `findLinkRunAt(block, offset)` into
  `packages/docs/src/view/link-run.ts` — returns the full
  `{ start, end, href }` of the link run at the caret (offset within
  `[start, end]` of an `href` inline, extended across adjacent runs with
  the same `href`), or `undefined` when the caret isn't in a link.
- [x] `editor.ts` `insertLink`: third branch — collapsed caret inside a
  link run → `applyInlineStyle` the new `href` over the whole run
  instead of inserting the URL as text. Dirty-marking mirrors
  `removeLink` (cell block → parent table block). Caret stays put.
- [x] `editor.ts` `removeLink`: refactor onto the shared helper.
- [x] `text-box-editor.ts` `insertLink` / `removeLink`: same third
  branch + same refactor (covers Slides text boxes and Slides table
  cells via the shared factory).
- [x] Tests:
  - `test/view/link-run.test.ts` — pure-function coverage: inside /
    trailing edge / leading edge / split same-href runs / no link /
    adjacent different-href links (tie-break toward the earlier run).
  - `test/view/edit-link-in-place.test.ts` — real `initialize()` +
    jsdom harness (same as `link-trailing-edge.test.ts`): selection-made
    link then caret click + `insertLink` updates in place (issue repro);
    trailing-edge caret updates in place; split (bold-prefix) run fully
    re-hrefed; caret outside any link still inserts URL text; undo
    restores the old href.
  - `test/view/text-box-edit-link-in-place.test.ts` — same via
    `initializeTextBox` (ArrowLeft to place the caret inside the link).
- [x] `pnpm verify:fast` green (89 docs test files, 1171 passed / 1 skipped; all packages green).
- [x] Self-review over the branch diff; apply blocking findings.
- [x] Re-landed on latest upstream `main` (`c810f4f02`) after the base
  moved 34 commits: the patch applied cleanly; the only overlapping
  upstream change is #548 (viewer read-only), which no-ops
  `insertLink`/`removeLink` at the EditorAPI boundary in read-only mode
  and hides the popover's Edit/Remove buttons — orthogonal to this fix
  and it gates the new branch automatically.

## Self-review

Dispatched an independent adversarial review agent over the branch diff
(the `/code-review` skill is not directly invocable in this session).
Findings:

- **Blocking, fixed**: `findLinkRunAt` matched a zero-width run on an
  empty-text inline carrying `href` — the residue `normalizeInlines`
  leaves when a linked paragraph is fully emptied (select-all + delete,
  or backspacing every character). The in-place branch then called
  `applyInlineStyle` over a `[0, 0]` range, a silent no-op: Apply did
  nothing and pushed a junk undo entry, where the pre-fix code inserted
  the URL. Fixed in the helper — an empty-text inline cannot anchor a
  run (still crossed by the lo/hi walk inside a wider same-href run),
  restoring the insert fallback. This also improves the exotic
  `[empty-href-X, "abc"-href-Y]` state: the caret at 0 now resolves to
  the real link Y instead of the zero-width X residue. Regression tests
  added in all three test files.
- **Non-blocking, not applied** (noted for the record):
  - `editor.ts`'s `if (!block)` guard after `doc.getBlock` is dead —
    `Doc.getBlock` throws rather than returning undefined. Pre-existing
    pattern shared by `removeLink`/`getLinkAtCursor` in the same file;
    kept for consistency, not a regression (the old branch threw
    equally inside `doc.insertText`).
  - The new caret branch doesn't call `setCursorForHistory` (the #523
    pattern used by the selection branch), so on the Yorkie store an
    undo of an in-place edit doesn't restore the caret to the link.
    Matches the pre-existing `removeLink` precedent; the edit itself
    never moves the caret.
  - Test gap: no table-cell-block coverage for the
    `cellInfo → markDirty(tableBlockId)` arm (mirrors `removeLink`,
    which is equally uncovered).
- **Verified correct by the review**: snapshot ordering for undo,
  dirty-marking parity with `removeLink`, `render`/`notifyStyleApplied`
  parity with sibling branches, caret staying put, no interaction with
  the #495 trailing-edge pending-style fix, popover flow consistency
  (`getLinkAtCursor` prefill ↔ Apply target, including the A|B
  boundary tie-break), and Slides inheriting the fix through the
  delegating text-box editor with no further change.

### Re-land review (on `c810f4f02`)

A second adversarial review over the re-landed diff against the moved
base found **no blocking issues**. Grounded verifications: the #548
read-only no-op allowlist makes the new branch unreachable in viewer
mode; `findLinkRunAt` matches `getLinkAtCursorPosition`'s empty-inline
exclusion and tie-break (popover shows == Apply edits); on the Yorkie
store empty non-image inlines can materialize but every reachable
residue state is the anchor-excluded case (delete/style paths prune
emptied inlines), and Yorkie `applyStyle` covers interior empties, so
the in-place update is whole-run correct on the CRDT path. Non-blocking
notes:

- **Deliberate behavior change**: caret at a link's trailing edge +
  Apply now edits that link in place (before: inserted an adjacent
  second link). Coherent with the popover prefill; call out in the PR
  body.
- `getLinkAtCursor` (unchanged) still returns href residue on a
  fully-emptied paragraph, so residue-state ⌘K prefills the old URL
  while Apply inserts new linked text — pre-existing prefill quirk,
  the fallback itself is the tested, intended behavior.
- Dead `if (!block)`-style guard and missing `setCursorForHistory` in
  the new branch: same pre-existing patterns as noted above.

## Out of scope

- Editing the link's display *text* from the popover (#494 mentions
  "URL and/or display text" — the popover currently only has a URL
  field; text editing is a separate feature).
- The popover UI itself (`docs-link-popover.tsx`) needs no change: it
  already calls `editor.insertLink(url)` and the fix makes that DTRT.
