# Slides Hover & Text-Edit Entry — Umbrella Roadmap

**Spec:** [`docs/design/slides/slides-hover-and-text-edit-entry.md`](../../design/slides/slides-hover-and-text-edit-entry.md)

Five-phase rollout bringing the Slides editor's idle-state hover feedback
and text-edit entry affordances to Google Slides parity.

## Shipped

- [x] **Phase A — P0** Idle hover outline + text-region I-beam cursor — PR #331
- [x] **Phase B — P1.4** Empty-placeholder 1-click text-edit entry — PR #334
- [x] **P0.3 / P2.6 (partial)** Enter / F2 keyboard entry + printable-char enters edit (pre-existing in `keyboard.ts`)

## Remaining

### Phase C — P1.5: Slow double-click

Pointer-down + pointer-up on an already-selected single text-capable element,
where `dist(down,up) < 3 px` and `up-down < 350 ms`, enters edit. Coexists
with `dblclick`.

**Key files:** `packages/slides/src/view/editor/interactions/drag.ts`
pointer-up classifier, `editor.ts:onDoubleClick` shared funnel into
`enterEditMode`. Tune constants at top of `drag.ts`.

- [ ] Implement slow double-click detector in pointer-up classifier
- [ ] Funnel through shared `enterEditMode`
- [ ] Unit tests for timing window + distance threshold
- [ ] Manual smoke against `dblclick` coexistence

### Phase D — P2.6 follow-up: forward first character into freshly mounted text-box

Close the v1 caveat at `keyboard.ts:506-513`. Extend `mountSlidesTextBox`
with `initialText?: string`, plumb through `enterEditMode(slideId,
elementId, options?)`, pass `{ initialText: e.key }` from the
printable-key rule.

**Key files:** `packages/slides/src/view/editor/text-box-editor.ts`,
`editor.ts:enterEditMode`, `interactions/keyboard.ts:514-532`.

- [ ] Extend `mountSlidesTextBox` with `initialText?` option
- [ ] Plumb through `enterEditMode(slideId, elementId, options?)`
- [ ] Forward printable key from `keyboard.ts`
- [ ] Unit on `initialText`-bearing mount path
- [ ] Browser scenario: select shape, type "H", expect "H" in the text-box

### Phase E — P2.7: Edge-zone resize cursor

Within 4 logical px of the selected element's edge (inside or outside the
bbox), show the matching resize cursor (`ns-resize`, `ew-resize`,
`nwse-resize`, `nesw-resize`). Skip when element rotation > 5°.

**Key files:** `packages/slides/src/view/editor/editor.ts:computeSelectedHoverCursor`
(added in Task A3), plus the existing handle hit region in `overlay.ts` for
the 8-direction lookup table.

- [ ] Extend `computeSelectedHoverCursor` with edge-zone region predicate
- [ ] Map 8 directions to cursor names
- [ ] Skip when rotation > 5°
- [ ] Unit tests for region detection and rotation skip
