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
- [ ] Share dialog: empty `GET /documents/:id/template` body is `null`, not a JSON parse error
- [ ] Every toast that forwarded `error.message` goes through `userFacingError` with a "Couldn't … " fallback
- [ ] Dialog titles sentence-case and specific (Delete / Rename / Move)
- [ ] Home demo hides itself when its share token does not resolve

## B — tokens and color
- [ ] Light primary fill/text meet AA (≥4.5:1), hover goes darker
- [ ] `input-border` token ≥3:1 for form-control boundaries
- [ ] Theme-aware toasts (sonner wrapper)
- [ ] `link` token; link popovers, sheets filter border, PDF highlights on tokens
- [ ] Detector items: theme-thumbnail `#ddd`, notes thumbnail grays, `text-[21px]`, notes-preview radii
- [ ] Workspace settings: one syrup button per view
- [ ] DESIGN.md + sidecar updated

## C — performance
- [ ] Entry bundle no longer preloads slides/sheets engines
- [ ] Eager-bytes budget in the chunk gate
- [ ] Fonts no longer render-blocking on editor routes
- [ ] Image thumbnails capped by size

## D1 — documents list + trash (frontend)
- [ ] Rows keep table semantics; title cell is the link
- [ ] Phone width: fewer columns, row menu reachable
- [ ] Delete moves to Trash with an Undo toast; Trash view with Restore / Delete forever
- [ ] Sidebar active state with id or slug URLs

## D2 — editor header consistency
- [ ] One fixed slot order across document types
- [ ] h1 is a heading containing a rename button
- [ ] One self-avatar rendering; presence button named
- [ ] Notifications: no "Mark all read" when nothing is unread

## E — keyboard and focus
- [ ] Comment Edit/Delete reachable by keyboard and touch
- [ ] Canvas context menus (slides/board, docs) have a menu keyboard model
- [ ] Font-size field focus indicator; `focus-ring` on raw buttons

## F — adapt and motion
- [ ] Coarse pointer: Button/Toggle/Switch/sidebar grow to 44px
- [ ] Docs and board mobile toolbars scroll instead of clipping
- [ ] Board minimap closed by default; viewport rect on tokens
- [ ] `prefers-reduced-motion` alternatives (dialogs, cards, presentation)

## G — trash (backend)
- [ ] `Document.deletedAt` + migration; delete is soft
- [ ] Restore + permanent delete + trash list routes (web + v1)
- [ ] Trashed documents invisible to every read path (lists, share links, Yorkie auth webhook, templates, copy, v1)
- [ ] Design doc + backend README

## Review
- [ ] Parallel review lenses over the full diff, fixes applied
- [ ] `pnpm verify:fast` green, `/self-review` rounds logged in lessons
- [ ] PR opened
