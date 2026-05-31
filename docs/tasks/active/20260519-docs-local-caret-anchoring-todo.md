# Docs Local Caret Anchoring

## Goal

Implement the local caret and text-selection anchoring design from
`docs/design/docs/docs-local-caret-anchoring.md` in the Yorkie docs store.

## Plan

- [x] Read PR feedback, the design note, and the existing Yorkie docs store flow.
- [x] Pin the design doc to the concrete Yorkie Tree position APIs and affinity rules.
- [x] Add local caret/range anchor conversion and resolution in `YorkieDocStore`.
- [x] Preserve current undo/redo cursor history behavior through `pendingCursorPos`.
- [x] Add focused unit coverage for body/header/footer/table anchors.
- [x] Add two-client integration coverage for caret and non-collapsed selection drift.
- [x] Expand the fallback ladder to cover previous/next region block per design.
- [x] Anchor `composition.startPosition` through the store so IME survives remote edits.
- [x] Add missing unit tests: round-trip, insert-after, same-boundary affinity,
      delete-before, delete-covering, split fallback, merge fallback,
      composition resolve/clear, fallback ladder.
- [x] Add header/footer two-client integration coverage.
- [x] Update design doc: pin Yorkie APIs, affinity rule, data-flow invariant,
      IME anchoring, fallback ladder, split/merge known limitations, open questions cleanup.
- [x] Run targeted docs store tests and `pnpm verify:fast`.

## Notes

- Keep Yorkie-specific anchor state inside `packages/frontend`.
- `pendingCursorPos` remains an absolute-offset history mechanism for now.
- `splitBlock` / `mergeBlock` use `delete + insert` rather than Yorkie's native
  `splitLevel=2`, so anchors that target deleted text fall through the
  deterministic ladder. Native split/merge is tracked as a follow-up.
