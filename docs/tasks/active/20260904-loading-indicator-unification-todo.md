# Unify the loading indicators across document types

## Problem

Entering a note document shows the loading indicator pinned to the **left
edge** of the editor area instead of centred. Measured in the running app
(MutationObserver over the real DOM):

| element | class | x | width | height |
| --- | --- | --- | --- | --- |
| `Loader` | `flex flex-col items-center justify-center min-h-[300px]` | 256 | **63** | 1123 |
| parent (`PreviewSurface`) | `relative flex flex-1 min-w-0` | 256 | **1016** | 1123 |

`Loader` declares no width of its own, so as a flex item in the row-flex
`PreviewSurface` it shrinks to its content width (63px) and lands at
`flex-start`. Its inner `items-center` centres content inside that 63px box,
which is why the spinner reads as "stuck to the left". The vertical axis is
fine because a row-flex item stretches.

`Loader` has not changed since the first commit; the layout around it did.
Call sites diverged: slides / board / mobile-slides wrap it in a centring box,
notes / docs / sheets / datasource / lakehouse do not.

A follow-up audit found the loading UI has fractured further — five different
visual languages, three different spellings of the word.

## Goals

- One centred loading indicator regardless of the parent's flex direction.
- One idiom at the call sites (no per-caller centring wrapper).
- One spelling of the loading label.
- Keep PDF's determinate progress bar (the only place with real progress),
  aligned typographically with the rest.
- Give the image viewer the spinner it never had.

## Non-Goals

- The `Skeleton` placeholders on list pages (workspace documents /
  datasources / settings). That is a list-loading pattern and is correct.
- The homepage demo's bespoke spinner (`home/demo-section.tsx`). Landing-page
  design, separate token set.
- Adding determinate progress anywhere it does not already exist.
- The two-stage flash (bare loader for the `me` query → app shell → editor).
  Real, but a routing/data-fetch change, not a loading-indicator change.

## Audit (before)

| # | implementation | appearance | used by |
| --- | --- | --- | --- |
| A | `components/loader.tsx` | 32px spinner + `Loading...` | sheet / doc / slides / note / board / share / history panel / route Suspense |
| B | `files/pdf-viewer.tsx` `LoadingOverlay` | 192px determinate bar + `Loading PDF… 42%` | pdf |
| C | `files/image-viewer.tsx` | bare text `Loading…`, no spinner | image |
| D | `Skeleton` blocks | grey placeholder rows | list pages (out of scope) |
| E | `home/demo-section.tsx` | hand-rolled CSS spinner | homepage (out of scope) |

Alignment within A. The parent's flex **direction** decides which axis
collapses, so the unwrapped call sites did not all fail the same way — a
correction to the first pass of this table, which called all five
"left-skewed":

| document type | parent | wrapper | result |
| --- | --- | --- | --- |
| slides `slides-view.tsx:1236` | row | `flex h-full w-full items-center justify-center` | centred |
| board `board-view.tsx:794` | row | same | centred |
| mobile slides `mobile-slides-view.tsx:461` | column | `flex flex-1 items-center justify-center` | centred |
| note `notes-view.tsx:199` | row (`PreviewSurface`) | none | **left-skewed** |
| doc `docs-view.tsx:613` | row | none | **left-skewed** |
| sheet `sheet-view.tsx:1538` | column (`document-detail.tsx:711`) | none | **top-skewed** |
| datasource `datasource-view.tsx:134` | column | none | **top-skewed** |
| lakehouse `lakehouse-view.tsx:351` | column | none | **top-skewed** |

A column-flex parent stretches its item on the cross axis, so those three
were full width but sat as a 300px box at the top of a tall column. One
`flex-1` fixes both failures, because it is the *main* axis that collapses in
either orientation.

Label spellings in use: `Loading...`, `Loading…`, `Loading PDF… 42%`,
`Loading rows...`, `Loading demo…`.

## Plan

- [x] 1. `Loader` centres itself: add `flex-1 w-full` and document the
      contract. `flex-1` is what does the work — it fills the **main** axis
      of a flex parent in either orientation, which is the axis that
      collapses. `w-full` is redundant in every parent shape that exists
      today and is kept only so a `flex-col items-center` parent cannot
      reintroduce shrink-to-fit on the cross axis. Both are inert in a block
      parent.
- [x] 2. Remove the now-redundant centring wrappers (slides-view,
      board-view, mobile-slides-view). Behaviour-neutral given step 1;
      verified per parent container.
- [x] 3. Unify the label on `Loading…` (single ellipsis character), including
      the `SiteHeader` title placeholders and `Loading rows…`.
- [x] 4. PDF `LoadingOverlay`: label `text-xs` → `text-sm` to match `Loader`.
      Keep the determinate bar.
- [x] 5. Image viewer: replace the bare `<p>Loading…</p>` with `<Loader />`.
- [x] 6. Regression test that pins the contract (a bare `Loader` must not
      shrink to content width inside a row-flex parent).
- [x] 7. `pnpm verify:fast` green.
- [x] 8. Self review over the branch diff.
- [x] 9. Manual smoke — see Review; done as a real-browser layout measurement
      rather than a click-through, for the reason in the lessons file.

## Review

### What changed

`Loader` gained `flex-1 w-full`, so it centres itself in a row-flex parent
(every editor canvas), a column-flex parent, and a block parent alike. Three
call sites that had each grown their own centring wrapper dropped them, and
five that never had one are now correct without gaining one. The label is
`Loading…` everywhere. The image viewer got the spinner it never had; PDF
kept its determinate bar with the label sized to match.

### Verification

`pnpm verify:fast` green (exit 0). Frontend unit suite: 1954 passed, 44
skipped. The five new tests in `components/__tests__/loader.test.tsx` failed
first and pass now.

Geometry measured in a real browser against the app's own stylesheet, in a
1016px `relative flex flex-1 min-w-0` box — the shape of `PreviewSurface`:

| | loader width | off-centre by |
| --- | --- | --- |
| before | 62px | 477px |
| after | 1016px | 0px |

62px reproduces the 63px measured in the running note editor during the
original diagnosis, which is what anchors the probe to the real bug.

### Review round

A reviewer over the full branch diff independently checked all ~25 `Loader`
call sites and found no layout regression — including the three that could
have produced one: the history panel (Radix `ScrollArea`'s viewport is
`display: table`, so `flex-1` is inert), `document-detail`'s column surface,
and `docs-detail`, the one place a `Loader` is a real row-flex *sibling* of
`HistoryPanel` (`flex h-full w-72`, `flex-grow: 0`, so `flex: 1 1 0%` claims
only free space and cannot squash it).

Applied from that review:

- The label scan's regex matched `Loading` followed by `...` anywhere on the
  line, which would have reported `const { isLoading, ...rest }` and
  `<LoadingOverlay {...p} />`. Tightened to require whole words between, with
  a test pinning both what it catches and what it must not.
- The contract comment had the axes inverted (in a row-flex parent width is
  the *main* axis, not the cross axis) and framed `flex-1`/`w-full` as two
  independently necessary halves. `flex-1` alone fixes every parent shape the
  app has; `w-full` is a guard, now documented as one.
- The audit table above called all five unwrapped call sites "left-skewed".
  Three were top-skewed. Corrected.
- `pdf-viewer`'s new comment named `text-primary` for the bar's fill; it is
  `bg-primary`.
- `packages/documentation/pdf/viewing-images.md` claimed the image viewer
  shows "a progress bar". It never did — it showed bare text, and now shows a
  spinner. Corrected, since this change is what made the line checkable.
- Test lookup moved from `parentElement` to `closest('[aria-live]')` and
  class checks from substring to `classList.contains`, so a wrapper or a
  `flex-1/2` cannot make an assertion pass by accident.

### Known limitations

- The jsdom lane can only assert the class contract, not the geometry. The
  real measurement lives in this file and in the test's comments.
- `image-viewer`'s parent is `items-center`, so the loader is not stretched
  there and `min-h-[300px]` is a hard floor inside an `overflow-auto` box. On
  a very short viewport that can show a transient scrollbar while the image
  downloads. Cosmetic, and only during load.
- `docs/tasks/README.md` is deliberately not regenerated here: `tasks:index`
  makes every pair of concurrent task branches conflict. Regenerate once
  after merge.
- The `error` branches in `slides-view` / `board-view` keep their centring
  wrapper. Their content is not a `Loader`, so the wrapper is still doing
  real work there.
- The two-stage entry flash (bare loader for the `me` query → app shell →
  editor) is unchanged; it is a data-fetch ordering problem, listed as a
  non-goal.
- `home/demo-section.tsx` keeps its bespoke spinner and the list pages keep
  their `Skeleton` blocks, both deliberately.
