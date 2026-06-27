# DOCX table deferred follow-ups — lessons

## Check EVERY DocStore implementation, not just the in-memory one (cost me a blocking bug)

My first pass concluded the table store ops were already region-aware after
grepping only `packages/docs/src/` — where `MemDocStore.findBlockInAnyArray`
*is* region-aware. I even rewrote the todo Scope line to drop
`packages/frontend/src/app/docs/yorkie-doc-store.ts`. But the production
editor uses `YorkieDocStore`, whose `resolveTableTreePath` searched only
`currentDoc.blocks` (body) and threw `Table block not found` for header/footer
tables. Dropping the `editContext === 'body'` guards therefore turned a safe
no-op into an uncaught crash in the real app — the exact thing #417's guards
prevented. The functions the todo named (`resolveTableTreePath`,
`findTableIndex`, `resolveTableBlock`) **did** exist — in the file I had
removed from scope.

A self code-review (multi-agent) caught it; the MemDocStore-only unit tests
all passed and masked it. Fix: make `resolveTableTreePath` delegate to the
already-region-aware `resolveBlockTreePath`, and make `resolveTableBlock`
pick the region root (body/header/footer) from the tree path. Added
header/footer structural-op tests in `yorkie-doc-store.test.ts`.

Lessons:
1. The `Store` abstraction has ≥2 impls (`MemDocStore`, `YorkieDocStore`).
   A behavior is only region-aware if **every** impl is — grep both
   `packages/docs/src/store/` AND `packages/frontend/src/app/docs/`.
2. Don't narrow a todo's Scope list without proving the dropped file is
   irrelevant. The original scope named yorkie-doc-store.ts for a reason.
3. Unit tests against the in-memory store can't prove the collaborative
   path. Add a matching test in `yorkie-doc-store.test.ts` for anything that
   touches store ops.

## Verify the stated root cause before implementing it

The todo also described the mechanism imprecisely for the *in-memory* store:
there, the table store ops (`insertTableRow`, etc.) were already region-aware
(keyed by block id via `findBlock` → `findBlockInAnyArray`). The real blockers were elsewhere:

1. Body-only block-array reads (`this.doc.document.blocks`) in
   `ensureBlockAfter`, `getPositionBeforeTable`, `getPositionAfterTable` —
   these already used the context-aware `getBlockIndex()` for the index but
   then indexed into the body array. Switch to `getContextBlocks()`.
2. The `editContext === 'body'` guards in `text-editor.ts`.
3. The editor API table commands resolving the cursor cell via the
   **body-only** `layout.blockParentMap`. The merged body+header+footer map
   lives on `doc.blockParentMap` (built in the render loop, line ~1140).

Lesson: when a todo names a mechanism, grep for it first. Map the real data
flow rather than trusting the description.

## Two parallel block-parent maps exist — pick the right one

`editor.ts` keeps a body-only `layout.blockParentMap` and a merged
`doc.blockParentMap` (= body ∪ header ∪ footer, set via
`doc.setBlockParentMap`). Anything that must work across regions (table
structural commands, `isInTable`, merge context) must use `doc.blockParentMap`.
`doc.editContext` is kept in sync by `setEditContext` (line 222), so
`doc.getContextBlocks()` / `getBlockIndex()` resolve correctly from the API.

## Don't let a width fallback re-enable structural hardening

First cut derived `columnWidths` from `tcW` *before* computing the structural
`numCols`, which re-enabled the grid shape-hardening (clamp, gridBefore
padding) that the gridless tests intentionally disable — silently dropping
cell content. Fix: keep the structural `numCols` gated on the real
`<w:tblGrid>` (0 when absent) and derive render-time `columnWidths`
*after* the row loop. Structural behavior and rendering width are separate
concerns; don't couple them through one array length.

## Mirror existing behavior exactly for affinity math

The HF caret resolvers had the same wrap-boundary bug the body resolver
(`resolvePositionPixel`) already solved. Copy the exact condition
(`affinity === 'forward' && remaining === lineChars && li < end - 1` →
jump to next line) rather than reinventing it, so all caret paths agree.

## Scope notes that became "known limitations"

- Absolute `<w:tblW>` import needs a model field (`TableData` only has
  fractional `columnWidths`). Calling that out kept the item honest rather
  than faking support.
- PDF export doesn't paint HF tables at all (`paintHFRegion` walks only
  `lb.lines`), so the page-number-in-HF-table fix is canvas-only. Checking
  the sibling renderer surfaced that the todo's "shared with PDF painter"
  note was inaccurate.
