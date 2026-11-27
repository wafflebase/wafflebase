# iPhone 16 clipping fixes

On an iPhone 16 (393×852 screen, ≈393×659 visible with Safari toolbars) the
Share dialog and several other surfaces are cut off. A five-agent audit at
393×659 (plus 393×852 and a 393×400 keyboard stand-in) found the causes
below. Fixed by four agents in parallel with disjoint file ownership.

## A — Base primitives + shared/Share (owner: agent A)

- [x] `ui/dialog.tsx`, `ui/alert-dialog.tsx`: cap height to the visible
      viewport (`max-h-[calc(100dvh-2rem)] overflow-y-auto`) and let grid
      children shrink (`[&>*]:min-w-0`)
- [x] `ui/sheet.tsx` bottom sheet: height cap
- [x] Share dialog: publish-as-template row wraps (`template-share-section.tsx:403`)
- [x] `vh` → `dvh`/`svh`: `lakehouse-dialog.tsx:363`, `shortcuts-help-dialog.tsx:55`
      (+ keep 1rem gutter), `more-fonts-dialog.tsx:182`
- [x] Shared viewers `h-screen` → `h-svh` (`shared-document.tsx`, `shared-notes-layout.tsx`)
- [x] Minor: Move dialog title under close X, workspace-settings rows/tables

## B — Docs + Notes overlays (owner: agent B)

- [x] Docs link popover clamped inside the viewport (`docs-link-popover.tsx`)
- [x] Docs table + body context menus: max-height + scroll (`docs-table-context-menu.tsx`, `docs-context-menu.tsx`)
- [x] Docs find bar clamped, input `min-w-0` (`docs-find-bar.tsx`)
- [x] Notes toolbar: Preview toggle reachable without a sideways swipe (`notes-toolbar.tsx`)

## C — Header + side panels (owner: agent C)

- [x] Site header: title keeps a readable width, Saving chip never overlaps (`site-header.tsx`)
- [x] History + Comments panels overlay full-width on mobile instead of a `w-72` column
- [x] Revision preview banner buttons wrap (`revision-preview.tsx:327`)

## D — Board mobile toolbar (owner: agent D)

- [x] Board toolbar: selection controls (sticky colours, Arrange) reachable on 393px
- [x] Board dropdowns get `collisionPadding`

## Verification

- [x] Re-run the 393×659 / 393×400 captures for every finding
- [x] `pnpm verify:fast`

## Review

- Integrated re-measure at 393×659 and 393×400: the Share dialog stays
  inside x 16–377 on sheet/doc/slides/note/board and scrolls to Create link;
  no page scrolls sideways.
- Lead additions: slides bottom sheet `80vh` → `80dvh`; PDF thread panel uses
  `SIDE_PANEL_CLASS`.
- Self-review round 1 (correctness + design fit + tests, one reviewer): no
  blocking findings. Applied: shortcuts dialog keeps its 512px desktop width
  (only the mobile gutter returns), `isCoarsePointer()` reuse, mobile Image
  disabled without a handler. Left as known limitations: dialog close X
  scrolls with content; no dedicated `BoardInsertSheet` / pinned-toolbar
  tests; notes toolbar nests the scrolling strip on desktop too.
