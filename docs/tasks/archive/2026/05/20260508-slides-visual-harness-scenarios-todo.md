# TODO — Slides visual harness scenarios

Add slides scenarios to the frontend visual regression harness so the
`verify:browser:docker` lane catches UI-level regressions on theme
picker, themed color/font pickers, formatting toolbar, and the canvas
renderer in a real browser. Complements the slides-package
node-canvas goldens (which cover the renderer in isolation).

## Tasks

- [x] Read existing `chart-scenarios.tsx` / `format-scenarios.tsx` /
      `sheet-scenarios.tsx` patterns
- [x] Create `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`
      with 5 scenarios:
  - `slides-canvas-default-light` — themed slide rendered to a real
    `<canvas>` via `drawSlide`, default-light theme
  - `slides-canvas-default-dark` — same slide, default-dark theme
  - `slides-toolbar` — `SlidesFormattingToolbar` mounted with mock
    props (no editor, no store) showing the layout
  - `slides-theme-panel` — `ThemePanel` mounted against
    `MemSlidesStore` showing the five thumbnails
  - `slides-color-picker` — `ThemedColorPicker` standalone with the
    default-light theme so the Theme / Standard / Custom sections
    render
- [x] Wire `<SlidesVisualScenarios />` into
      `packages/frontend/src/app/harness/visual/page.tsx`
- [x] Add the 5 scenario ids to
      `packages/frontend/scripts/verify-visual-browser.mjs`
      (`scenarioIds` array)
- [x] Generate baselines via
      `pnpm verify:browser:docker:update` (Docker = CI parity)
- [x] Run `pnpm verify:browser:docker` to confirm baselines match
- [x] Run `pnpm verify:fast` to confirm no regressions in unit lane
- [x] Verify chunk gate not breached
      (`pnpm verify:frontend:chunks`) — the harness page imports
      slides UI which already sits in the slides-detail chunk
- [x] Commit + push to existing PR1 branch

## Review

(filled in at completion)
