# Slides Hover & Text-Edit Entry — Umbrella Roadmap

**Spec:** [`docs/design/slides/slides-hover-and-text-edit-entry.md`](../../design/slides/slides-hover-and-text-edit-entry.md)

Five-phase rollout bringing the Slides editor's idle-state hover feedback
and text-edit entry affordances to Google Slides parity.

## Shipped

- [x] **Phase A — P0** Idle hover outline + text-region I-beam cursor — PR #331
- [x] **Phase B — P1.4** Empty-placeholder 1-click text-edit entry — PR #334
- [x] **P0.3 / P2.6 (partial)** Enter / F2 keyboard entry + printable-char enters edit (pre-existing in `keyboard.ts`)
- [x] **Phase C — P1.5** Slow double-click on already-selected text-capable element — branch `slides-hover-followup-phases`
- [x] **Phase D — P2.6** First-printable-char forwarding into freshly mounted text-box — branch `slides-hover-followup-phases`
- [x] **Phase E — P2.7** Edge-zone resize cursor for selected element — branch `slides-hover-followup-phases`

## Open follow-ups (manual / browser)

- [ ] **Phase C** Manual smoke against `dblclick` coexistence — confirm a
      fast dblclick on a selected text-capable element still enters edit
      exactly once (P1.5 fires on the up, `onDoubleClick` then no-ops via
      the `editingElementId` guard).
- [ ] **Phase D** Browser scenario: select shape, type "H", expect "H" in
      the text-box. The Vitest jsdom suite at
      `test/view/editor/text-box-initial-text.test.ts` covers the wiring;
      browser test is the regression hedge across real Canvas + IME.

## Smoke-test fixes (Phase D follow-on, same branch)

- [x] **docs text-box: composing preview wiring** — `text-box-editor.ts`
      did not pipe `TextEditor.onComposingContextChange` into
      `computeLayout(..., composingContext)`, so partial Hangul jamo and
      browser IME pre-edits never rendered. Reported during Phase D smoke
      (typing `ㄱ` showed nothing until the syllable completed). Same
      file: `handleBlur` now calls `textEditor.cancelComposition()`
      before snapshotting blocks so an in-progress syllable lands in the
      commit instead of getting silently dropped on focus-out. Regression
      tests in `packages/docs/test/view/text-box-composing.test.ts`.
