# a11y + Radix cleanup (Stage 1+2)

Scope: no new dependencies. Frontend chrome only (not canvas internals).
Result of a Radix-usage / a11y review. High-severity issues: none. This is
accessibility-label coverage + a few hand-rolled widgets → existing Radix
wrappers.

## Stage 2 — Radix wrapper cleanups (`components/ui/`)

- [x] `separator.tsx:14` — `data-slot="separator-root"` → `"separator"`
- [x] `context-menu.tsx:1` — drop no-op `"use client"`
- [x] `context-menu.tsx:45` — align `data-[inset=true]` → `data-[inset]` with dropdown-menu

## Stage 2 — Find bars → Tooltip / Toggle

- [x] `app/docs/docs-find-bar.tsx` — icon buttons `title=` → Tooltip; match-case/regex → Toggle; inputs aria-label; counter aria-live
- [x] `components/find-bar.tsx` — prev/next/close icon buttons → Tooltip; find input aria-label; counter aria-live
- [x] `app/docs/docs-detail.tsx:177` — comments toggle `<button aria-pressed>` → Toggle (+ Tooltip)

## Stage 1 — a11y label coverage (no Radix change)

Workspaces / docs / share:
- [x] `app/workspaces/workspace-settings.tsx` — icon buttons aria-label (remove-member, copy-invite, revoke-invite, revoke-key, copy-key); confirm input htmlFor/id; name/slug/key-name input aria-labels
- [x] `app/datasources/datasource-list.tsx` — filter input aria-label
- [x] `app/documents/document-list.tsx` — filter input aria-label; row keyboard nav (role=button/tabIndex/onKeyDown)
- [x] `components/share-dialog.tsx` — copy/revoke link aria-label
- [x] `components/tab-bar.tsx` — add-tab aria-label; rename input aria-label
- [x] `components/datasource-selector.tsx` — aria-pressed on selection
- [x] `app/spreadsheet/datasource-view.tsx` — SQL textarea aria-label; query error role=alert
- [x] `app/docs/docs-link-popover.tsx` — URL input aria-label (icon buttons already labeled)
- [x] `components/text-formatting/line-spacing-picker.tsx` — aria-label
- [x] `components/mobile-edit-panel.tsx`; `app/slides/toolbar/table-controls.tsx` — aria-labels
- [x] Grid pickers keyboard nav: `app/docs/table-grid-picker.tsx`, `app/slides/table-picker.tsx` (role=grid + arrow/Enter, focus stolen on menu open)
- [ ] Low (deferred): invite-accept / shared-document role=status/alert; why-section icon alt

## Verify
- [x] `pnpm verify:fast` green (frontend 574 tests pass, lint clean)
- [ ] manual smoke for find bars + comments toggle + grid-picker keyboard nav

## Review

Scope delivered: 18 frontend files. Two Radix-correctness wrapper fixes, find
bar Tooltip/Toggle conversions, comments-panel Toggle, ~30 aria-label/aria-live
additions, two table-size grid pickers made keyboard-operable.

Self-review (code-review skill, medium) surfaced one real bug: the new
grid-picker keyboard handlers were **unreachable** because the grids render
inside a Radix `DropdownMenuContent` (focus goes to the content container, Tab
into descendants is blocked). Fixed by `onOpenAutoFocus` → focus the grid, plus
`stopPropagation()` on handled keys. All other changes verified correct.

Deferred (low severity, can be a follow-up): role=status/alert on async
status text in invite-accept/shared-document; text alt on why-section
comparison icons. Not migrated (deliberate): canvas context menus (Radix blocks
canvas pointer events), comment/link popovers (need a `Popover` primitive — that
was Stage 4, out of scope here).
