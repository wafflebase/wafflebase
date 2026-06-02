---
title: docs-ime-undo-history
target-version: 0.4.4
---

<!-- Proposed — ready for maintainer review before implementation (issue #318). -->

# Docs IME Undo History

## Summary

Make a single IME-composed character (e.g. one Hangul syllable) a single undo
entry in the docs editor, so one Undo removes it cleanly — matching how a typed
English character already behaves, and how Google Docs / Notion handle IME.

Today, typing one Hangul syllable via the browser IME lands as **multiple
overlapping undo units** at the same position. Stepping through them with Undo
makes the character appear to "toggle" between visible and hidden instead of
being removed once (issue #318):

- 1st Undo → character disappears
- 2nd Undo → same character reappears
- 3rd Undo → disappears again …

The character is only truly gone after an even number of undos. English input is
unaffected.

## Background

### How undo/redo works in the docs editor

Undo/redo in the docs editor is implemented by **Yorkie's document history**. The
editor keeps no undo stack of its own — `YorkieDocStore.snapshot()` is a no-op
(`packages/frontend/src/app/docs/yorkie-doc-store.ts:2469`), and `undo()` /
`redo()` delegate straight to `doc.history.undo()` / `doc.history.redo()`
(`yorkie-doc-store.ts:2473`–`2485`). The document text lives in the
`root.content` Tree, and every edit is a `doc.update()` that mutates it; the undo
stack is whatever Yorkie records for those updates.

So "an undo entry" in this editor means **one entry on Yorkie's undo stack**, and
the bug's "multiple undo history entries" are exactly that.

### How Yorkie forms undo units (confirmed against @yorkie-js/sdk 0.7.8)

From the SDK source, after each `doc.update()` the change is executed, its
`reverseOps` are collected, and **iff there is at least one reverse op, exactly
one entry is pushed onto the undo stack**:

```
// @yorkie-js/sdk 0.7.8, Document.update internals
if (reverseOps.length) {
  this.internalHistory.pushUndo(reverseOps);   // one undo unit per doc.update()
}
```

The undo stack is therefore `Array<Array<HistoryOperation>>` — one array per
`doc.update()`, holding all reverse ops of that single transaction
(`getUndoStackForTest(): Array<Array<HistoryOperation<P>>>`). Two consequences,
both load-bearing for this design:

1. **One `doc.update()` = one undo unit.** Multiple Tree edits inside the *same*
   `doc.update()` collapse into one unit.
2. **There is no way to exclude a Tree edit from history, and no cross-update
   grouping.** `update(updater, message?)` exposes no "skip history" option, and
   Tree edits always produce reverse ops. (The SDK's `addToHistory` flag applies
   only to *presence* `set`, not to Tree edits.)

**This bug is not a Yorkie defect.** Yorkie records exactly one undo unit per
`doc.update()`, as designed. The defect is that IME composition issues many
`doc.update()`s for one character.

### Why one Hangul syllable becomes many undo units

The IME pipeline in `packages/docs/src/view/text-editor.ts` writes **interim
composition state into the Tree** and rewrites it repeatedly:

- `handleInput()` during an active composition (`text-editor.ts:455`–`476`): for
  each `compositionupdate` it does `docDeleteText(previous interim)` then
  `docInsertText(current interim)`.
- `handleCompositionEnd()` (`text-editor.ts:401`–`416`): it again does
  `docDeleteText(interim)` then `docInsertText(finalText)`, using `e.data` as the
  source of truth (to correct iOS textarea drift).

`docInsertText` / `docDeleteText` (`text-editor.ts:264`–`289`) each call
`doc.insertText` / `doc.deleteText`, and each of those is its own `doc.update()`
in `YorkieDocStore` (`yorkie-doc-store.ts:1502`+). So a single jamo `"ㅏ"`
produces, at minimum:

| Step | Mutation | `doc.update()` | undo unit |
| --- | --- | --- | --- |
| compositionupdate | insert `"ㅏ"` | #1 | insert ㅏ |
| compositionend | delete 1 | #2 | delete ㅏ |
| compositionend | insert `"ㅏ"` | #3 | insert ㅏ |

A composed syllable like `"가"` (ㄱ → 가) adds another delete+insert pair during
composition, reaching ~5 units. Every unit is a delete or insert at the **same
start position**, so undoing them one at a time alternates the character on and
off — exactly the reported toggle.

> Aside: the issue's own guess (compositionstart vs compositionend as two
> entries) is directionally right but not exact — the entries come from the
> per-`compositionupdate` interim delete/insert plus the compositionend
> delete/insert, each a separate `doc.update()`.

## Goals

- One IME composition that yields one composed character = **one undo unit**. One
  Undo removes it; one Redo restores it.
- Behavior parity with English input and with Google Docs / Notion.
- Correct across regions that share `root.content`: body paragraphs, headers,
  footers, and table cells.
- No regression to live composition rendering (the composing glyph still shows
  while typing) or to the pending inline-style anchor.

## Non-Goals

- Changing undo granularity for non-IME edits (English typing, paste, structural
  edits) — those already behave correctly.
- Coalescing a whole multi-syllable *word* into one undo unit. Scope is one
  composed character = one unit (each Korean syllable ends its own composition).
  Word-level grouping is a possible follow-up.
- Replacing or re-architecting Yorkie history.

## Proposal Details

### Decision: interim composition must not produce a `doc.update()`

Per the SDK analysis above, the undo stack gets one unit per `doc.update()`, with
no way to exclude or group Tree edits. So **the only way to stop generating extra
undo units is to stop issuing `doc.update()`s for interim composing text.**
Grouping multiple updates into one unit (an earlier "Approach B") is not
expressible in @yorkie-js/sdk 0.7.8 and is rejected.

Normative rules:

1. While a composition is active, **no `doc.update()` / Tree edit is performed**
   for interim composing text.
2. The committed text is written to the Tree **exactly once**, in a single
   `doc.update()`, when the composed character is final → one undo unit.
3. In-progress composing text is **view-local**: rendered transiently at the
   caret, never written to the document model. A direct consequence: because the
   interim is no longer in the shared model, collaborators see the character only
   once it is committed, not the half-composed jamo (see Risks / Open Questions #2).

### Implementation shape

`packages/docs/src/view/text-editor.ts`:

- **`handleCompositionStart`** (`:386`) — keep capturing `startPosition` and the
  anchored composition position (the `updateCompositionStartPosition` bridge from
  `docs-local-caret-anchoring.md` / PR #257 stays). A selection present at start
  (`deleteSelection()`, `:391`) is its own concern — see Open Questions #1.
- **`handleInput` while composing** (`:455`–`476`) — replace the
  `docDeleteText`/`docInsertText` pair with updating a **transient composing
  string** (view-local) and a render request. No model mutation.
- **`handleCompositionEnd`** (`:401`–`416`) — clear the transient string and
  perform **one** `docInsertText(anchoredStartPosition, e.data)` →
  one `doc.update()` → one undo unit. No interim delete needed (nothing was
  written to the model).

Rendering the transient composing text:

- Today the composing glyph is visible only because interim text is written to
  the model and painted from it; there is **no existing transient text overlay**
  for composition (image overlays exist in `doc-canvas.ts`, but not text). So this
  change adds a small transient-render path: paint the composing string as a
  view-local run at the caret position (reusing existing measure/paint), drawn
  after the document content and cleared on `compositionend`.

`packages/docs/src/view/hangul.ts` (software Hangul assembly, used when the
browser does not fire composition events): it already separates `commit` vs
`composing` (`hangul.ts:86`–`89`). Route `composing` through the same transient
render and `commit` through the single `docInsertText`, so both the browser-IME
path and the software path yield one undo unit per syllable.

`packages/frontend/src/app/docs/yorkie-doc-store.ts`: no API change required;
`insertText()` already wraps a single `doc.update()`. The anchored start position
(`updateCompositionStartPosition`) must be used so the single commit lands at the
drift-corrected position, not a stale absolute offset.

### Risks and Mitigation

- **New transient render path is the main cost.** Composing text must now be
  painted view-locally. Mitigation: reuse existing run measurement/painting;
  scope it to a single run at the caret; cover with the IME browser script.
- **Pending inline-style anchor.** The `pending` style logic currently rides on
  the interim delete/insert (`keepPending` / `rewindAnchor`, `text-editor.ts:268`,
  `:284`). With no interim edits, rebind the anchor off the single final insert.
  Add a "set style → IME-type → style applied to composed char" unit test.
- **Syllable boundaries.** Korean fires `compositionend` → `compositionstart`
  back-to-back between syllables; each syllable is its own composition and its own
  single undo unit. Confirm no stranded transient string and no cross-syllable
  merge.
- **Tables / headers / footers.** All share `root.content`; cover composition
  inside a table cell.
- **iOS textarea drift.** The `e.data` source-of-truth at compositionend is
  preserved — we still commit `e.data`, just once and without the interim churn.
- **Peer visibility of composing text.** Because interim text is no longer
  written to the shared model, collaborators no longer see in-progress jamo and
  see the character only on commit. Mitigation: this matches Google Docs / Notion
  and is treated as the intended behavior; confirm in Open Questions #2.

## Test Plan

- Unit (`packages/frontend/tests/app/docs/yorkie-doc-store.test.ts`, which has
  undo/redo coverage but no IME case): typing one jamo and one composed syllable
  each grows `getUndoStackForTest().length` by exactly 1; one undo empties, one
  redo restores.
- Unit: pending inline-style survives IME composition.
- Browser (`packages/docs/scripts/verify-ime-browser.mjs`): assert one Undo
  removes a composed syllable in a single step — single + multi-syllable, batchim,
  mixed EN/KR, compose-after-delete.
- Table-cell composition undo.

## Open Questions (decisions requested)

1. **Selection-replace grouping.** When composition starts over a selection, the
   `deleteSelection()` is a real edit. Should it be the **same** undo unit as the
   composed insert (one Undo restores the original selection *and* removes the
   character) or **two**? Proposed: one unit — fold the delete and the final
   insert into a single `doc.update()`.
2. **Peer visibility of composing text.** Approach A makes the in-progress
   composition view-local, so collaborators see the character only on commit.
   Proposed: accept this (matches Google Docs / Notion). Confirm it is acceptable;
   if live composing visibility is required, the interim would have to be shared
   by some non-undo channel (e.g. presence), not the document model.
3. **Transient render technique.** Paint the composing run on the canvas
   (proposed, keeps a single rendering pipeline) vs. a positioned visible
   `textarea` overlay. Confirm preference.

## References

- Issue: https://github.com/wafflebase/wafflebase/issues/318
- Yorkie history: `@yorkie-js/sdk` 0.7.8 — `Document.update` `pushUndo(reverseOps)`,
  `getUndoStackForTest(): Array<Array<HistoryOperation>>`.
- Related: `docs/design/docs/docs-local-caret-anchoring.md` (issue #237 / PR #257)
- Related: `docs/design/docs/docs-pending-inline-style.md` (pending style anchor)
