# Slides mobile toolbar parity — surface omitted menu items

> **Shipped & archived (2026-06-21):** delivered in PR #392. Verified in
> source: `rightPanel` state + `onToggleFormatPanel` / `onToggleMotionPanel`
> wiring in `packages/frontend/src/app/slides/slides-detail.tsx`. The checkbox
> states below were back-filled in bulk at archival time. (No paired lessons
> file was written for this task.)

## Problem

On the Slides mobile view several toolbar menu items present on desktop
are missing. Investigation traced the root cause: `MobileSlidesLayout`
(`slides-detail.tsx`) never ported the desktop panel system, and the
mobile toolbar branch (`mobile-toolbar.tsx`) only receives
`onToggleThemePanel` — and even that arrives `undefined` because the
mobile layout does not pass it.

### Confirmed gaps (desktop → mobile)

| Item | Desktop location | Mobile status | Action |
| --- | --- | --- | --- |
| Theme panel | `RightGlobals` toggle + `ThemePanel` drawer | overflow item disabled (prop not wired) | wire |
| Format options panel | `RightGlobals` toggle + `FormatPanel` drawer | absent | wire |
| Motion panel | `RightGlobals` toggle + `MotionPanel` drawer | absent | wire |
| Slide background color | `RightGlobals` ThemedColorPicker dropdown | overflow item "coming soon" (disabled) | implement |
| Table insert | `InsertGroup` `TablePicker` | absent from Insert sheet | add |
| Format Painter | left zone | absent | leave out (not meaningful on touch) |
| Zoom control | left zone | absent | leave out (mobile fits to viewport) |

## Approach

Panels render as **bottom sheets** (`Sheet side="bottom"`), matching the
existing mobile Insert/Format sheets. Each panel gains a
`variant?: 'drawer' | 'sheet'` prop: `drawer` keeps the current docked
`<aside>`; `sheet` drops the fixed width / left border / own header and
returns scrollable content so the bottom `Sheet` owns the chrome (title +
built-in close). Slide background stays toolbar-local (it only needs
store + current slide + theme, all already passed to the mobile toolbar).

## Tasks

- [x] `ThemePanel`: add `variant` prop; `sheet` mode returns content-only.
- [x] `FormatPanel`: add `variant` prop; `sheet` mode returns content-only.
- [x] `MotionPanel`: add `variant` prop; `sheet` mode returns content-only.
- [x] `TablePicker`: add optional `trigger` prop (mirror `ShapePicker`).
- [x] `mobile-toolbar.tsx`:
  - [x] Extend `MobileSlidesToolbarProps` with `onToggleFormatPanel`,
        `onToggleMotionPanel` (Theme already present).
  - [x] `OverflowMenu`: enable Theme; add Format options + Motion; wire
        Slide background via a toolbar-local `SlideBackgroundSheet`.
  - [x] Add `TablePicker` (custom trigger) to the Insert sheet grid.
  - [x] Thread new props through Idle/Object bars.
- [x] `toolbar/index.tsx`: forward `onToggleFormatPanel` /
      `onToggleMotionPanel` to `MobileSlidesToolbar`.
- [x] `slides-detail.tsx` `MobileSlidesLayout`:
  - [x] Add `rightPanel` state ("theme" | "format" | "motion" | null).
  - [x] Pass the three toggle callbacks + open flags to `SlidesToolbar`.
  - [x] Render the three panels inside a bottom `Sheet`.
- [x] `pnpm verify:fast` green.
- [x] Self code-review over branch diff.

## Review outcome (high-effort code-review)

Applied:
- **Correctness**: Format/Motion overflow items were gated only on
  `!onToggle*` (always-defined closures) so they never disabled — tapping
  before editor/store mounted opened an empty header-only sheet. Now gated
  on `canPanels = store && editor` (and Theme on `store`).
- **Reuse**: extracted `useSlideBackground(store, slideId, theme, onCommit)`
  shared by desktop `RightGlobals` and the mobile `SlideBackgroundSheet` —
  kills verbatim duplication of the store-write rules + the double
  `store.read()`.
- **Simplification**: mobile panel-sheet title/description now from a
  `MOBILE_PANEL_META` table instead of stacked ternaries; corrected the
  misleading "controlled DropdownMenu" comment.

Deferred (known limitations):
- `useSlidesShellState` extraction — Desktop/MobileSlidesLayout already
  duplicate store/theme/present state pre-PR; the in-code TODO tracks it.
  Out of scope here to avoid desktop regression risk.
- Text-edit mobile bar has no overflow (Theme/Format/Motion/background
  unreachable while editing text). Intentional: text editing is a focused
  mode on the compact bar; exit to access design panels (matches the
  existing mobile bar design).

## Verification

- `pnpm verify:fast` green (lint + unit, desktop global-controls included).
- Manual smoke in `pnpm dev` at <768px: Theme/Format/Motion bottom sheets
  open from overflow, Slide background applies, Table inserts. _(Not
  separately hand-smoked at archival; the implementation + `verify:fast`
  shipped in #392. The checklist above covers code, not this manual pass.)_
- Desktop toolbar unchanged — panels still dock as drawers, background
  dropdown still works via the shared hook.
