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

## Browser smoke spun out

Real-browser scenarios for Phases C (dblclick coexistence) and D
(English / Korean type-to-edit) are tracked in
[`20260607-slides-hover-text-edit-browser-smoke-todo.md`](20260607-slides-hover-text-edit-browser-smoke-todo.md).
They are deferred until the slides interaction-test harness lands;
neither blocks merging the umbrella feature work.

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
