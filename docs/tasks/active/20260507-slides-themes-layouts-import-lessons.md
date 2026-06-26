# Lessons — Slides Themes, Layouts, and PPTX Import

Captured during implementation. Update at the end of each PR with anything
that would help a future similar task.

## PR1 follow-ups (non-blocking)

Captured during code review of Task 4 (commit `6a60ce32`). Address before
PR1 merge or in a follow-up cleanup commit:

- **`makeColorResolver` role guard.** `packages/slides/src/view/canvas/text-renderer.ts:30-46` casts
  `c as ThemeColor`, widening `StoredColor.role: string` to `ColorRole`. With `tint`/`shade` set on
  an unknown role name, `parseHex(undefined)` produces a NaN-laden hex. Not exercised today (no
  caller persists tint/shade with bad roles), but the PPTX importer in PR2 will write tint/shade.
  Add `if (!theme.colors[c.role]) return undefined;` in `makeColorResolver` before invoking
  `resolveColor`, or document the unknown-role behavior.
- **`wrapLegacyColor` callers.** Exported from `@wafflebase/docs` but unused in this PR. Spec'd
  to be used by the PPTX importer (PR2) and migration paths. Keep for now; verify it's actually
  wired in PR2 — if not, drop.
- **`theme-panel.tsx` styling convention.** Uses ~50 lines of inline styles. Sibling React shell
  files in `packages/frontend/src/app/slides|docs/*.tsx` use Tailwind utility classes. Container
  chrome (border-l, padding, flex column, width, overflow) should convert to
  `className="flex w-[220px] flex-col gap-3 overflow-y-auto border-l p-3 shrink-0"` to align
  dark-mode / token usage. `theme-thumbnail.tsx` inline styles are defensible (each theme paints
  a different palette) and can stay.
- **`currentThemeId` initial value.** `slides-detail.tsx` hardcodes `'default-light'` as the
  initial state; drifts if `BUILT_IN_THEMES[0].id` ever changes. Either `useState<string | null>(null)`
  and let the `store.onChange` sync handle first paint, or import the constant.
- **Font picker `value` hardcoded to `undefined`** (`slides-formatting-toolbar.tsx:347`). Picker
  never shows an active marker even immediately after a write. Acceptable per the text-font-role
  deferral (`InlineStyle.fontFamily` is still `string` in docs), but at minimum read the first
  inline run's `style.fontFamily` to back-match a `{ kind: 'family' }` value within a session.
  Add a TODO comment.
- **Keyboard accessibility on popovers.** Manual popovers in `slides-formatting-toolbar.tsx` use
  `role="dialog"` but lack Escape-to-close and focus-trap. Add a short `keydown`/Escape handler.
  Full focus trapping can wait for Radix Popover adoption.
- **Toolbar duplication.** Fill and Font popover blocks in `slides-formatting-toolbar.tsx` are
  ~45 lines each and nearly identical. Extract a `<TogglePopover trigger content disabled />`
  wrapper to halve and make adding a third picker cheap.
- **Text font role-tracking in docs.** Extend `docs/InlineStyle.fontFamily` from `string` to
  `string | ThemeFont` (parallel to `color: StoredColor` extension) so slides text font picks
  preserve role bindings. Without it, theme-switch on text-fonted decks doesn't follow the
  new theme.
- **Render contextual popovers via React portal.** Resolved in PR1 by switching to Radix
  `DropdownMenu`, which auto-portals to body. The earlier `!overflow-visible` override on the
  slides Toolbar is gone. Keep this pattern for future contextual popovers (alignment, etc.).
- **Picker palette detail polish (deferred).** The PR1 themed color and font pickers now match
  docs/sheets aesthetic via Tailwind + DropdownMenu, but spacing, swatch sizing, hover states,
  and the Standard color selection deserve another pass. Possible follow-ups: (a) fine-tune
  swatch dimensions vs the rest of the toolbar, (b) replace native `<input type="color">` with
  a richer hex input + recent-color memory, (c) match Google Slides' standard-color palette
  more deliberately (we currently reuse the docs `TEXT_COLORS` constant).

## PR2 post-merge audit (2026-05-16, Yorkie 캐즘 deck)

Visual audit of the 36-slide benchmark imported via PR2/#243 (deck at
`/shared/17025f9e-cd3f-4793-91e3-593cd899e3fe`). Overall fidelity is
good: hyperlinks render, connectors route, images upload, notes and
fonts survive. Two findings worth tracking:

- ~~**Table cell margins (`<a:tcPr marL/marR/marT/marB>`) ignored.**~~
  Fixed in follow-up `20260516-pptx-table-cell-margins-todo.md`: parse
  `<a:tcPr>` `marL/marR/marT/marB` with ECMA-376 defaults
  (marL=marR=91440 EMU, marT=marB=45720 EMU) and inset the text frame
  while keeping the border rect on the cell's outer frame. Visible on
  the benchmark in slides 24, 25, 26, 27 (전파/저장 grid:
  "저장 XMemory") and 33, 34, 35 ("Yorkie 개발hackerwins").
- **GIF images render as a still frame.** Slide 36's
  `media/image24.gif` survives the upload path but plays no animation.
  Acceptable for v1 (the design doc never promised motion media) — note
  for future media support.

Non-issues confirmed during audit (logged so the next pass doesn't
re-investigate):

- Many sidebar thumbnails appear "blank" at 206×116 because thick body
  text shrinks to sub-pixel sizes; the main canvas shows full content
  (e.g. slide 13 thumb looks empty but the slide is the full
  Liveblocks-positioning chart). Thumb scaling is a rendering choice,
  not an import regression.
- Slides 33-36 having a black canvas matches the original master/layout
  background — not a theming bug.
- Notes that look empty (e.g. slides 33-35, 36) are genuinely empty
  in the source deck.

## PR3 (theme builder) — re-review + store/render layer (2026-06-25/26)

Resuming a ~1-year-deferred design. Lessons from grounding it against the
shipped code:

- **Re-review before coding a deferred design.** The original plan assumed
  "every builder edit propagates to all slides." Reality split in two:
  theme/master colors + fonts already cascade via render-time role
  resolution (free repaint), but layout placeholder **positions** and
  master placeholder **type styles** are copied/seeded at slide-creation
  and need an explicit cascade. Background fill wasn't rendered with
  inheritance at all. Finding this first reshaped the commit plan and
  avoided building the wrong thing.
- **`getLayout()` read from the shared `BUILT_IN_LAYOUTS` constant**, not
  `doc.layouts`, so document-local layout edits were invisible to
  addSlide/applyLayout. Any per-deck layout feature must resolve layouts
  from the doc first. Fixed via a `resolveLayout` helper in both stores.
- **Background inheritance required making `Background.fill` optional.**
  Slides previously always carried an explicit fill (role 'background'),
  so master/layout fill never showed. Made fill optional (`{}` = inherit),
  routed all readers (canvas, PDF) through `resolveBackgroundFill` /
  `resolveBackgroundImage`, and crucially fixed `migrateBackground` which
  was force-defaulting absent fills to white — that would have pinned
  every migrated slide and broken inheritance. Absent fill resolves to the
  background role (white for default-light), so old decks look identical.
- **Smart cascade beats blunt override.** "User-moved untouched" is
  implementable without persistent override tracking: re-flow a slide
  placeholder only when its frame still equals the layout's *pre-edit*
  frame (`framesApproxEqual`); re-seed master type styles only on *empty*
  placeholders. Both detect "did the user customize this?" from current
  state, no extra flags.
- **YorkieSlidesStore has no unit-test harness.** MemSlidesStore is the
  TDD reference (30 new cases); the Yorkie store mirrors it in-place on
  CRDT proxies and is covered by integration/browser lanes. Keep the two
  implementations behaviorally identical method-for-method.
- **Frontend isn't typechecked in CI** (`vite build` only, no `tsc`); the
  gate is `eslint` + `vitest`. `tsc -b` shows ~120 pre-existing errors —
  don't treat it as a gate, but DO scan its output filtered to your own
  files to catch real type breaks (e.g. a missing package export only
  surfaces after `pnpm slides build` refreshes dist).
- **Process slip:** ran a bare `git stash` to compare against main while
  commit-1 work was uncommitted — it stashed everything. `git stash pop`
  recovered it. Commit (or at least don't stash) before reaching for
  comparison tricks on a dirty tree.

## Brainstorming
