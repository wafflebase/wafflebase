# Design Docs Archive

This folder holds design documents whose feature has shipped and that
no longer represent ongoing design intent for the project. They live
here so the main `docs/design/` index stays focused on documents that
new contributors should read first, while historical context is still
discoverable.

A document belongs here when **all** of these are true:

- The feature it describes is fully shipped.
- It is single-PR-sized (one concrete migration, one self-contained
  UX detail) rather than a subsystem reference.
- Its design content has not been merged into a successor doc that
  treats the same surface (those get deleted instead — git history
  preserves the content).
- Removing it from the main index would help someone scanning the
  table of contents understand what is currently load-bearing.

Documents whose successor *did* absorb their content are simply
deleted; the commit message and `git log` point future readers at
the absorbing doc.

## Contents

| Document | Original location | Why archived |
| --- | --- | --- |
| [conditional-format-multi-range.md](conditional-format-multi-range.md) | `sheets/` | One-shot `range → ranges` migration shipped in v0.2.x; no ongoing design surface. |
| [peer-cursor-labels.md](peer-cursor-labels.md) | `sheets/` | The presence-schema half was superseded by `sheets/axis-id-selection.md` (`SelectionPresence`). The transient-label UX (4 s auto-show on cell change, hover, edge-case clamping) shipped against `overlay.ts` and is preserved here for reference. |
| [docs-frontend-integration.md](docs-frontend-integration.md) | `docs/` | v0.3.0 PR notes for adding the `type` field to documents and routing to the Docs editor. Historical context for the dual-editor UI. |
| [slides-shape-move.md](slides-shape-move.md) | `slides/` | Single-interaction ghost-drag UX for selected shapes. Standalone PR note; the broader shape system lives in `slides/slides-shapes.md`. |
| [docs-ime-undo-history.md](docs-ime-undo-history.md) | `docs/` | Single-PR fix (issue #318) coalescing one composed Hangul character into a single Yorkie undo unit. Shipped; no ongoing design surface. |
| [docs-list-item-backspace-exit.md](docs-list-item-backspace-exit.md) | `docs/` | Single-PR interaction fix (issue #338): Backspace on an empty list item exits the list. Shipped; self-contained. |
| [docs-mobile-zoom-to-fit.md](docs-mobile-zoom-to-fit.md) | `docs/` | Single-PR viewport feature — Canvas scale transform for narrow viewports. Shipped; no dependents. |
| [docs-table-ui.md](docs-table-ui.md) | `docs/tables/` | Toolbar grid picker + context menu + IME routing for tables. UI plumbing on top of the table data model in `docs/docs-tables.md`. |
| [slides-shift-modifiers.md](slides-shift-modifiers.md) | `slides/` | Self-contained Shift-drag constraints (1:1 draw, 15° angle/endpoint snap, axis-locked move). Pure constraint helpers; shipped. |
| [slides-pasteboard.md](slides-pasteboard.md) | `slides/` | Pasteboard v1 — variable off-slide area inside `scrollHost` so off-slide shapes stay visible/selectable. Self-contained UX; shipped. |
| [slides-color-picker.md](slides-color-picker.md) | `slides/` | Commit/record onChange flags + per-document recent colors (`Meta.recentColors`). Self-contained picker behaviour; shipped. |
