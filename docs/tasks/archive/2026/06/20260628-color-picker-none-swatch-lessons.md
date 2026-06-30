# Lessons — color picker "None / transparent" unification

## What the investigation surfaced

"Should we offer a transparent color?" is really two questions:

1. **None / No fill** (binary, "don't paint") — belongs in fill-like
   contexts (fill, background, highlight, border). NOT in text color.
2. **Alpha / opacity** (continuous, "partly see-through") — only meaningful
   where objects layer (Slides). Docs/Sheets are opaque models. Out of scope.

The codebase already had concept #1 — but implemented **three different
ways** (`ColorPickerGrid` "Reset" button, a bespoke "No fill"
`DropdownMenuItem` in table-controls, and *nothing* for shape fill). The
valuable work was **consolidation**, not a brand-new feature.

## Technical notes

- **`updateElementData({ fill: undefined })` clears the key.** The store
  (`yorkie-slides-store.ts`) special-cases `v === undefined` → `delete`, so
  passing `undefined` is the correct "no fill" path. Re-assigning a cloned
  `data` would have silently dropped the clear (`JSON.stringify` strips
  `undefined`).
- **Default-selected trap.** A first cut used `noneSelected = !value`; with
  `value` undefined (call sites that don't track it) that's always `true`,
  so every Reset/None control would render selected. Fixed to
  `value === ""` — undefined = "unknown, don't indicate", `""` = "no color,
  show selected".
- **Slide background is NOT a no-fill context.** It inherits
  layout → master → role via `resolveBackgroundFill`, so "No fill" there
  means "reset to inherited", a different concept, and `backgroundFill`
  never resolves to `undefined` (selected state can't work). Deferred —
  deserves its own "reset to theme" treatment.
- **Keep `ThemeColor` clean.** Modeled clear as a separate `onClear`
  callback prop rather than adding a `kind: 'none'` to the `ThemeColor`
  union — the union stays about *colors*, and `undefined` already is the
  data-model representation of no-fill.

## Alpha / Transparency (Google-Slides location)

- **Where Google puts it:** color *alpha* lives in the **Custom color
  dialog** (Fill/Border ▸ Custom ▸ Transparency slider), per-color — NOT a
  palette swatch, NOT the Format options panel. Format options' Transparency
  is **image-only** (Adjustments). So the slider belongs in
  `ThemedColorPicker`'s Custom section, gated by `allowAlpha`.
- **The model & renderer already supported alpha** — `ThemeColor.alpha`,
  `resolveColor` returns `rgba()` for `alpha < 1`, and `shape-renderer` /
  `resolveStrokeColor` paint it (PPTX export already round-trips
  `<a:alpha>`). Always check the render path before building color UI: had
  alpha *not* been painted, the slider would have been a silent no-op.
- **Opaque = absence of alpha, not `alpha: 1`.** `withAlpha` drops the field
  at ≥1 so `resolveColor` keeps its no-alpha fast path and exports stay
  clean.
- **GS "Transparency" convention is inverted opacity:** slider 0% = solid
  (alpha 1), 100% = invisible (alpha 0). Reused the exact mapping the
  drop-shadow section already uses (`(1 - opacity) * 100`).
- **All `ThemedColorPicker` call sites are fill/border/background** — even
  `text-element-controls` (text-*box* fill, tooltip "Fill color") and
  `mobile-toolbar` (slide background). Glyph text color goes through
  `ColorPickerGrid`, so "no alpha on text" falls out for free.
- **Lint gotcha:** the repo's `no-unused-vars` flags even
  `_`-prefixed names — don't use the `const { alpha: _drop, ...rest }`
  discard idiom; copy + `delete` instead.

## Alpha-slice code review (2 finders) — addressed / deferred

- **Fixed (blocker): drag churn.** First cut wrote to the store on every
  `onValueChange` tick → a single transparency drag became dozens of undo
  units + CRDT ops. Switched to the drop-shadow pattern: a transient
  `dragTransparency` state drives the thumb during the gesture, and the
  store write happens once in `onValueCommit` (pointer release / keyboard).
  One drag = one undo unit. Added a keyboard-driven wiring test.
- **Deferred (parity, minor): alpha resets on color re-pick.** `makeSrgbColor`
  / `makeRoleColor` produce no alpha, so picking a new swatch *after* setting
  transparency drops it (Google preserves it). The natural order — pick
  color, then transparency — works. Documented as a known limitation; a fix
  would thread the current alpha through every swatch handler.
- **Kept (judgment): uniform NoneSwatch on the "Reset" control.** A reviewer
  noted the red "no-fill" slash on text-color *Reset* (restore-default, not
  transparent) is a slight semantic conflation vs Google. Kept uniform — the
  "Reset"/"None" text label disambiguates and a split icon adds branching for
  marginal gain. Revisit if it reads wrong in the manual smoke.
- Confirmed non-issues: `withAlpha` preserves role fields (lumMod/tint/shade);
  border/role alpha render through `resolveColor`/`resolveStrokeColor`; the
  visual harness scenario passes neither `allowAlpha` nor `onClear` so the
  baseline is unchanged.

## Follow-ups (noted in todo)

- Alpha/opacity UI in the Slides custom section (model already supports it).
- HEX text input across pickers.
- Slide-background "reset to inherited" affordance.
- `ColorPickerGrid` selected-indicator wiring (`value=""`) at docs/sheets
  call sites — left opt-in this PR.
- Visual baselines: docs/sheets color dropdowns now show a NoneSwatch
  instead of the `IconDropletOff` "Reset" row; refresh if snapshotted.
