# Slides panel native form elements → Radix migration

## Background

A Radix-adoption review found that the frontend consolidates 14 Radix
packages through `components/ui/` wrappers, but the recently added Slides
motion/format panels skipped that convention and used native form elements
directly. Consistency leaked — e.g. the Slider wrapper and a native range
coexisting in the same file. This task cleans up that leak.

## Targets (grep-verified)

- `app/slides/motion-panel/animation-section.tsx`
  - native `<select>` ×5 (category/effect/direction/start/easing)
  - native `<input type="range">` ×1 (duration)
  - native `<input type="checkbox">` ×1 (by paragraph)
- `app/slides/motion-panel/transition-section.tsx`
  - native `<select>` ×2 (type/speed)
- `app/slides/format-panel/text-fitting-section.tsx`
  - native `<input type="radio">` ×3 (autofit mode)
- `app/slides/format-panel/size-position-section.tsx`
  - native `<input type="radio">` ×2 (unit in/cm)

## Tasks

- [x] Add `@radix-ui/react-radio-group` dependency (^1.4.1)
- [x] Create `components/ui/radio-group.tsx` wrapper (shadcn pattern)
- [x] `animation-section.tsx`: select→Select (×5, MotionSelect helper),
      range→Slider, checkbox→Checkbox
- [x] `transition-section.tsx`: select→Select ×2
- [x] `text-fitting-section.tsx`: radio→RadioGroup
- [x] `size-position-section.tsx`: unit radio→RadioGroup
- [x] Preserve aria-labels (accessibility / test-selector equivalence)
- [x] `pnpm verify:fast` green (EXIT=0, 933 tests)
- [x] Production build green (EXIT=0)

## Review

- Removed all native form elements: `<select>`×7, `range`×1,
  `checkbox`×1, `radio`×5.
- The 5 identically-structured selects in `animation-section` were
  consolidated into a generic `MotionSelect<T>` helper to remove
  duplication. The "update effect when category changes" logic is
  preserved in the onChange callback.
- Slider/Checkbox were adapted to the `number[]`/`boolean` callback
  signatures (value semantics unchanged).
- Radix Select renders as a button trigger rather than a native
  `<select>`, so values must be strings → transition speed's numeric
  `durationMs` is converted via `String()`/`Number()`.
- `text-fitting-section.test.tsx`: assertions updated from native
  `.checked` to the Radix `aria-checked` attribute (test intent =
  "correct item selected", verified equivalently via the accessibility
  representation). 2 fixed.
- `size-position-section.test.tsx`: aria-label lookup + `fireEvent.click`
  pass identically against Radix radios → no change needed.

## Code review (high effort, 7 angles)

- **Refuted candidate**: "wrapping a RadioGroupItem in a `<label>`
  nullifies label-text clicks" → a `<button>` is a labelable element, so
  the wrapping label still forwards the click. An empirical test confirmed
  clicking the text node calls onCommit → no regression.
- **Pre-existing behavior (not a regression)**: transition speed showing
  an empty trigger for non-preset `durationMs` (e.g. PPTX 700ms), and
  continuous batch updates during slider drag — both were already present
  with the native `<select>`/`range`. Split out as separate work.
- **Applied cleanups**:
  - Replaced the Delay field (the last remaining native `<input>`) with
    the shared `Input` component and removed the dead `NUMBER_INPUT_CLASS`
    constant (design-system token consolidation).
  - Hoisted the static option arrays (Category/Start/Easing/Direction) to
    module scope (removing per-render reallocation per animation). Effect
    stays inline because it depends on category.
- **Deferred (non-blocking)**: extracting `MotionSelect` into a module
  shared with transition-section — poor fit because of Speed's
  number/string conversion, split out as follow-up work.

## Non-goals

- Side-panel shared shell extraction (needs separate design)
- CommentPopover → Radix Popover (introduces a separate dependency)
- Icon library unification
- Sheets text-format toolbar alignment

## Review notes

- No unit/integration tests directly target these panels (grep
  confirmed) → low regression risk.
- Radix Select renders as a button trigger rather than a native
  `<select>` → DOM changes. aria-labels are kept; verified that selectors
  don't depend on the `select` tag.
