# Board usability pass

Source: `/impeccable critique` of the board editor (2026-11-16, 19/40),
snapshot in `.impeccable/critique/`. One PR, fixed one issue at a time with
a user check-in after each.

## Items

- [x] 1. Esc commits an in-flight sticky / text edit instead of discarding it
      (`packages/slides/src/view/editor/editor.ts` `cancelled` flag; slides too)
- [x] 2. Board plane stays light in dark mode (canvas background + grid);
      content resolves against `defaultLight`, so the plane must match it
- [x] 3. New sticky steps right off an occupied viewport centre
      (`sticky.ts` `freeStickyCenter`). Images still land on the centre:
      their size is only known after the upload decodes, so the same
      footprint test needs to move into `insertImageOnSlide` — deferred
- [x] 4. Sticky identity: inline 6 sticky swatches when a sticky is selected,
      hide border weight / dash / gradient, "Add sticky note" in canvas menu
- [x] 5. Minimap viewport rect collapses when viewport > content
      (`board-minimap.ts` bounds = scene ∪ viewport)
- [x] 6. Discoverability: empty-board hint, V/T/N/S/L tool keys, shortcuts in
      tooltips, board shortcuts help (Cmd+/)
- [ ] 7. Minor: zoom menu (in/out, <50%), uppercase picker labels, canvas menu
      checkmark, tooltip re-show after menu close; investigate the uncaught
      `YorkieError: fail to find` during undo/redo
- [ ] 8. FigJam-parity roadmap: `docs/design/board/board-figjam-parity.md`
- [ ] 9. Polish pass, `pnpm verify:fast`, self-review, PR

## Review

(filled in at the end)
