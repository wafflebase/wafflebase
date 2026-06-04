# IME Undo History — one composed character = one undo unit (issue #318)

Branch: `docs/ime-undo-history` · Design: `docs/design/docs/docs-ime-undo-history.md`

## Status

Implementation done (approach B) and `pnpm verify:fast` green. Self-review
round 1 findings addressed (see "Review round 1" below). New tests: 11 layout
injection + 7 editor-level IME + 5 frontend store (undo units + presence clamp).
Remaining before merge: manual smoke in `pnpm dev`, lessons file, archive, push.

Untracked files that must NOT be staged into this PR: `.claude/issues.md`,
`docs/design/docs/docs-ime-undo-history.ko.md`,
`docs/design/docs/docs-local-caret-anchoring-ko.md` (KO translations, unrelated).

### Review round 1 (addressed)
- [x] **Blocker — presence leak:** caret offset past model length (view-local
      composing) was published raw to peer presence. Fixed: `clampPosToModel`
      in `yorkie-doc-store.ts` clamps `activeCursorPos` + selection endpoints
      before `p.set`. Tested.
- [x] **Stale preview after remote anchor correction:** `setCompositionStartPosition`
      now re-`emitComposingContext()` + marks old/new block dirty + requests
      render. Path-covered by test.
- [x] **Ghost text on blur/abort:** added `TextEditor.cancelComposition()`
      (commits visible preview, clears injection); called from `handleBlur`.
      Tested (browser + software-Hangul paths).
- [x] **Software-Hangul undo:** confirmed snapshot timing unchanged from
      original; under Yorkie each commit is one undo unit (fix now applies to
      this path too). Added software-Hangul view-local + flush test.
- [x] CodeRabbit ts code-fence nit.

## Problem

Typing one Hangul syllable via the browser IME lands as multiple overlapping
Yorkie undo units (interim `compositionupdate` delete/insert pairs + the
`compositionend` delete/insert), so Undo "toggles" the character on/off instead
of removing it once. Yorkie records exactly one undo unit per `doc.update()` and
offers no cross-update grouping (confirmed @yorkie-js/sdk 0.7.8) — so the fix is
to stop issuing `doc.update()`s for interim composing text and commit the final
text exactly once.

## Chosen render approach: B — layout injection (NOT the note's original A)

The design note proposed painting the composing run at the caret on the canvas
(approach A). That overlaps following text on mid-paragraph composition (no
reflow). We instead inject the composing text as a **view-local synthetic run
into `layoutBlock()`**, so wrapping / following-text-shift is correct while the
document model stays untouched. The design note is updated to record this.

Injection seam (from layout-engine exploration):
- `layoutBlock()` (`layout.ts:328`), right after `measureSegments()` and before
  the wrapping loop — splice a synthetic `MeasuredSegment` at the composing
  offset.
- Thread a `composingContext?: { blockId, offset, text, style }` param through
  `computeLayout()` (`layout.ts:215`) → `layoutBlock()`.
- All regions (body / header / footer / table cell) funnel through the same
  `layoutBlock()`, so one seam covers them all.
- Caret pixel resolution (`resolvePositionPixel`, `peer-cursor.ts:97`) walks the
  synthetic run like any normal run — no change needed.

## Tasks

### 1. Design note + plan
- [ ] Update `docs-ime-undo-history.md`: record approach B (layout injection) as
      the chosen transient-render technique; note reflow correctness; adjust
      Open Question #3 to "resolved: layout injection".
- [ ] Fix CodeRabbit nit: add `ts` language tag to the fenced SDK snippet (`:49`).

### 2. Layout: view-local composing run injection
- [ ] Add `ComposingContext` type and optional param to `computeLayout` +
      `layoutBlock`; splice synthetic segment after `measureSegments()`.
- [ ] Ensure the synthetic run carries correct `charOffsets`/width and is marked
      so it's never persisted (scope-local to layout only).
- [ ] Thread `composingContext` from `editor.ts recomputeLayout()` (read from
      TextEditor composition state); mark caret block dirty each keystroke.

### 3. text-editor.ts: stop interim model writes
- [ ] `CompositionState`: replace `currentLength` (model-written length) with
      `composingText: string` (view-local).
- [ ] `handleInput` while composing (`:455–476`): no `docDeleteText`/
      `docInsertText`; just set `composingText`, move caret to start+len, request
      render.
- [ ] `handleCompositionEnd` (`:401–416`): no interim delete; single
      `docInsertText(anchoredStart, e.data)` → one `doc.update()` → one undo unit.
      Keep `e.data` as source of truth (iOS drift).
- [ ] `handleCompositionStart` (`:386`): keep `startPosition` capture + anchor
      bridge (PR #257). Selection-present → fold `deleteSelection()` + final
      insert into one undo unit (Open Question #1 proposed: one unit).
- [ ] Software Hangul path `applyHangulResult` (`:4505`): route `composing` via
      the view-local render, `commit` via single `docInsertText`.
- [ ] Expose composing state to editor's layout (getter or callback) so
      `recomputeLayout` can build `composingContext`.

### 4. Pending inline-style anchor
- [ ] Rebind pending-style anchor off the single final insert (interim
      delete/insert `keepPending`/`rewindAnchor` no longer fire). Verify
      `pending.consumeForInsert` still applies style to the committed char.

### 5. Tests
- [ ] Unit (`yorkie-doc-store.test.ts`): one jamo and one composed syllable each
      grow `getUndoStackForTest().length` by exactly 1; one undo empties, one
      redo restores.
- [ ] Unit: pending inline-style survives IME composition.
- [ ] Unit/layout: composing-run injection reflows following text (width grows,
      wrap happens) and caret sits at start+len.
- [ ] Browser (`packages/docs/scripts/verify-ime-browser.mjs`): one Undo removes
      a composed syllable in one step — single/multi-syllable, batchim, mixed
      EN/KR, compose-after-delete.
- [ ] Table-cell composition undo.

### 6. Verify + ship
- [ ] `pnpm verify:fast` green.
- [ ] Self code-review over branch diff; manual smoke in `pnpm dev` (compose
      mid-paragraph, header, table cell; Undo once).
- [ ] Capture lessons; archive; PR body Summary + Test plan; address review.

## Risks / watch-outs
- Syllable boundary: Korean fires `compositionend`→`compositionstart` back to
  back; confirm no stranded `composingText` and no cross-syllable merge.
- Composing run must clear on `compositionend` AND on composition abort (focus
  loss, Escape) — leftover injection would show ghost text.
- Peer visibility: collaborators now see the char only on commit (accepted,
  matches Google Docs / Notion — Open Question #2).
- Incremental layout cache keys off blockId only; marking the caret block dirty
  each keystroke is required or the composing run won't update.
