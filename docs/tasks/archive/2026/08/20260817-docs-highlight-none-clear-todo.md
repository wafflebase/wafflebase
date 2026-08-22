# Docs: Highlight "None" must clear `backgroundColor`, not store `""`

Issue: #793

## Problem

The docs colour pickers' **None** / **Reset** entries call
`editor.applyStyle({ backgroundColor: "" })`. The inline-style write path merges
the incoming style over the existing one, so the run ends up carrying
`backgroundColor: ""` — a dead value that

- never re-merges with its neighbours (`inlineStylesEqual` compares colours with
  `storedColorsEqual`, and `'' !== undefined`), so the run split is permanent, and
- reads as "there is a highlight" to anything that treats a *present*
  `backgroundColor` as one (export paths included).

The package already has a convention for "clear": pass the key explicitly set to
`undefined` (`CLEAR_INLINE_STYLE`, `removeLink` → `{ href: undefined }`), which
both the memory merge and the Yorkie `removeStyleByPath` path already honour.
`""` simply never joined that convention.

## Approach

Define `""` as a clear at the inline-style write boundary in `@wafflebase/docs`,
rather than patching each picker call site. Four docs surfaces pass `""` today
(`text-format-group.tsx` ×2, `docs-formatting-toolbar.tsx` ×2) and a fifth would
reintroduce the bug; normalizing once also heals runs that already store `""`
the next time the user clears them.

- [x] `packages/docs/src/model/types.ts` — add `normalizeStyleClears(style)`
      mapping `color`/`backgroundColor` of `''` to an explicit `undefined`
      (key kept, so the Yorkie remove path sees it).
- [x] `packages/docs/src/store/block-helpers.ts` — run the incoming style through
      it in `applyInlineStyle` (memory store + Yorkie cache path).
- [x] `packages/frontend/src/app/docs/yorkie-doc-store.ts` — same in
      `applyStyleInTree`, so the CRDT attribute is removed rather than set to `""`.
- [x] Tests: block-helpers unit test replaying the issue's repro (highlight on,
      then None → back to one run, no `backgroundColor` key); `types` unit test
      for the helper.
- [x] `normalizeCellStyleClears` + the same boundary in `MemDocStore.applyCellStyle`
      and `YorkieDocStore.applyCellStyle` — see the scope note below.

The table-cell half started as a Non-goal and was pulled in. It is not a bug
fix — the table context menu's **Reset** already passes `backgroundColor:
undefined`, and #728 already gave `applyCellStyle` a removal path for that. What
it buys is one contract instead of two: `''` and `undefined` now mean the same
"clear" at every docs style boundary, so a cell picker wired the way the four
inline pickers are wired cannot reintroduce the dead value. Both stores delete
the key rather than leaving it present holding `undefined`, so `key in style`
answers the same in either. Sheets is still out — different model.

## Non-goals

- #749 (`false` stored for a toggled-off boolean style) — same shape, separate fix.
- Sheets background reset — different model.
- Healing already-stored `""` on document load (no migration pass).

## Verification

- `pnpm --filter @wafflebase/docs test` (targeted files)
- CI: `verify:self` lanes on the PR.
