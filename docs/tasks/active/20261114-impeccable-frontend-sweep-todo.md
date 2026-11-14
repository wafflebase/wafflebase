# Impeccable frontend sweep (critique 25/40, audit 13/20)

Source: `.impeccable/critique/2026-11-14T06-41-13Z__packages-frontend-src.md`
and `.impeccable/audit/2026-11-14T06-41-25Z__packages-frontend.md`. Scope:
everything, one PR, implemented by parallel agents over disjoint file
territories. Self-hosted `/` keeps the marketing page but hides the demo when
its share token is unavailable.

Shared primitives added before the fan-out:
`userFacingError(error, fallback)` in `src/api/http-error.ts`, and the
`focus-ring` utility in `src/index.css`.

## A — errors, copy, self-host demo
- [x] Share dialog: empty `GET /documents/:id/template` body is `null`, not a JSON parse error
- [x] Every toast that forwarded `error.message` goes through `userFacingError` with a "Couldn't … " fallback
- [x] Dialog titles sentence-case and specific (Delete / Rename / Move)
- [x] Home demo hides itself when its share token does not resolve

## B — tokens and color
- [x] Light primary fill/text meet AA (≥4.5:1), hover goes darker
- [x] `input-border` token ≥3:1 for form-control boundaries
- [x] Theme-aware toasts (sonner wrapper)
- [x] `link` token; link popovers, sheets filter border, PDF highlights on tokens
- [x] Detector items: theme-thumbnail `#ddd`, notes thumbnail grays, `text-[21px]`, notes-preview radii
- [x] Workspace settings: one syrup button per view
- [x] DESIGN.md + sidecar updated

## C — performance
- [x] Entry bundle no longer preloads slides/sheets engines
- [x] Eager-bytes budget in the chunk gate
- [x] Fonts no longer render-blocking on editor routes
- [x] Image thumbnails capped by size

## D1 — documents list + trash (frontend)
- [x] Rows keep table semantics; title cell is the link
- [x] Phone width: fewer columns, row menu reachable
- [x] Delete moves to Trash with an Undo toast; Trash view with Restore / Delete forever
- [x] Sidebar active state with id or slug URLs

## D2 — editor header consistency
- [x] One fixed slot order across document types
- [x] h1 is a heading containing a rename button
- [x] One self-avatar rendering; presence button named
- [x] Notifications: no "Mark all read" when nothing is unread

## E — keyboard and focus
- [x] Comment Edit/Delete reachable by keyboard and touch
- [x] Canvas context menus (slides/board, docs) have a menu keyboard model
- [x] Font-size field focus indicator; `focus-ring` on raw buttons

## F — adapt and motion
- [x] Coarse pointer: Button/Toggle/Switch/sidebar grow to 44px
- [x] Docs and board mobile toolbars scroll instead of clipping
- [x] Board minimap closed by default; viewport rect on tokens
- [x] `prefers-reduced-motion` alternatives (dialogs, cards, presentation)

## G — trash (backend)
- [x] `Document.deletedAt` + migration; delete is soft
- [x] Restore + permanent delete + trash list routes (web); restore + permanent delete on v1 (no v1 trash list — known limitation)
- [x] Trashed documents invisible to every read path (lists, share links, Yorkie auth webhook, templates, copy, v1)
- [x] Design doc + backend README

## Review
- [x] Parallel review lenses over the full diff, fixes applied
- [ ] `pnpm verify:fast` green, `/self-review` rounds logged in lessons
- [ ] PR opened
