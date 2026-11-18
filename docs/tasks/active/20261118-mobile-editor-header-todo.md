# Mobile editor header: one control size, panel/export in a More menu

On an iPhone 16 (393×659, coarse pointer) the editor header mixes five
control shapes in one row — 44×44 bordered panel toggles, a 34×44 Share,
32×32 export triggers (below the 44px touch floor), a 58×34 split Slideshow
button and a borderless bell — and Docs leaves its title 99px
("Quarterly …").

Measured on `main` (scratch capture, 2026-11-18):

| Editor | Header controls | Title width |
|---|---|---|
| Sheets | comments 44 · history 44 · share 34×44 · bell | 135px |
| Docs | comments 44 · history 44 · export 32×32 · share 34×44 · bell | 99px |
| Slides | slideshow 58×34 · export 32×32 · share 34×44 · bell | 133px |
| Notes | history 44 · share 34×44 · bell | 101px |
| Board | comments 44 · history 44 · share 34×44 · bell | 135px |

## Plan

- [x] `SiteHeader`: below 768px (`useIsMobile`, the app's mobile branch)
      keep `primary` and `share` in the bar and move `comments`, `history`
      and `export` into a `⋮ More` dropdown. Slots learn where they are
      through a `HeaderPlacement` context (`bar` / `compact` / `menu`).
- [x] `HeaderPanelToggle` renders a checkbox menu item in the menu.
- [x] Docs / Slides export render their formats as a labelled menu group in
      the menu (flat, no submenu: submenus are fiddly on touch).
- [x] `PresentButton`: on a phone the bar keeps a single play button;
      "Present from beginning" moves to the More menu.
- [x] One header control size: 32px square on fine pointers, 44px square on
      coarse (Share, export triggers, Slideshow, bell, More).
- [x] Tests: site-header mobile overflow, toggle-as-menu-item.
- [x] `pnpm verify:fast`; before/after captures for all five editors.
- [x] Header rule recorded in `DESIGN.md` § Layout (no design doc describes the slots).

## Review

Measured after (same capture, 393×659, coarse pointer): every header control
is 44×44 — Share, More, bell, and Slides' play button.

| Editor | Row | Title width before → after |
|---|---|---|
| Sheets | share · more · bell | 135 → 140 (full title) |
| Docs | share · more · bell | 99 → 173 |
| Slides | play · share · more · bell | 133 → 125 |
| Notes | share · more · bell | 101 → 101 (full title) |
| Board | share · more · bell | 135 → 137 (full title) |

Slides loses 8px of title: the Slideshow split button (58×34) plus the
32px export trigger became two 44px squares. Accepted — the row is now one
size, and export moved into the menu.

Known limits:
- `useIsMobile` resolves after the first paint, so a phone renders the wide
  header for one frame (the sidebar has the same behaviour).
- The More menu unmounts its rows on close, so an export's `exporting` guard
  lives only as long as the menu; the toast still reports progress.
- The bell stays in the row: it carries the unread badge, and the sidebar is
  hidden behind its trigger on a phone.
