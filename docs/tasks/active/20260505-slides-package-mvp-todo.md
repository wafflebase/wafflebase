# Slides Package (v1 MVP) — Task Tracking

Design doc: [slides.md](../../design/slides/slides.md)

Brainstorming summary: see commit message for `docs/design/slides/slides.md`.

## Phase 1: Foundation

- [x] 1.1 Scaffold `packages/slides` — `package.json`, `vite.config.ts`, `tsconfig`, README
- [x] 1.2 Add `@wafflebase/slides` to root `pnpm-workspace.yaml` build, `pnpm slides` filter alias
- [x] 1.3 `model/presentation.ts` — `SlidesDocument`, `Slide` (incl. `notes`), `Layout` types
- [x] 1.4 `model/element.ts` — `TextElement`, `ImageElement`, `ShapeElement` discriminated union
- [x] 1.5 `model/frame.ts` — coordinate math, hit-testing, rotation matrices (with property tests)
- [x] 1.6 `model/layout.ts` — built-in layout templates (title, title+body, blank); reapply preserves user content
- [x] 1.7 `store/store.ts` — `SlidesStore` interface (incl. `duplicateSlide`, multi-slide ops, `withNotes`)
- [x] 1.8 `store/memory.ts` — `MemSlidesStore` reference impl + full mutation tests
- [x] 1.9 `store/memory.ts` — `batch()` for undo/redo grouping (sheets pattern; pointer = 1 batch, IME-aware text grouping)
- [x] 1.10 `pnpm slides test` green; verify:fast green

## Phase 2: Static Rendering

- [x] 2.1 `view/canvas/element-renderer.ts` — draw rect/ellipse/line/arrow/image
- [x] 2.2 `view/canvas/element-renderer.ts` — text via docs layout engine call
- [x] 2.3 `view/canvas/slide-renderer.ts` — background + element loop, dirty tracking
- [x] 2.4 `view/canvas/thumbnail.ts` — small-canvas re-render, debounce
- [x] 2.5 Standalone HTML harness with sample fixtures for visual review
- [x] 2.6 Renderer unit tests against mock `CanvasRenderingContext2D`

## Phase 3: Editor (Single-User)

- [x] 3.1 `view/editor/editor.ts` — controller, store wiring
- [x] 3.2 `view/editor/selection.ts` — single + multi-select + lasso, stable IDs
- [x] 3.3 `view/editor/interactions/drag.ts` — move with snap guidelines
- [x] 3.4 `view/editor/interactions/resize.ts` — 8 handles, shift-aspect, rotated case
- [x] 3.5 `view/editor/interactions/rotate.ts` — free + 15° snap
- [x] 3.6 `view/editor/interactions/insert.ts` — toolbar → click/drag-to-place
- [x] 3.7 `view/editor/interactions/nudge.ts` — Arrow / Shift+Arrow
- [x] 3.8 `view/editor/interactions/clipboard.ts` — Cmd+C/X/V (`application/x-wafflebase-slides+json`)
- [x] 3.9 Slide thumbnail interactions — Cmd+D duplicate, multi-select, drag reorder
- [x] 3.10 z-order keyboard shortcuts (Cmd+↑/↓/⇧↑/⇧↓)
- [x] 3.11 Right-click / long-press context menus (built on `docs/design/context-menu.md`)
- [x] 3.12 Speaker notes panel (collapsible bottom strip, View toggle)
- [x] 3.13 Undo/Redo via `store.batch` groups (pointer + IME boundaries)
- [x] 3.14 Vitest interaction tests (drag/resize/rotate matrix, undo, clipboard)
- [x] 3.15 Spike: docs RichText page-assumption audit (1 day, gates Phase 5 plan)

## Phase 4: Yorkie + Multi-User

- [x] 4.1 `packages/frontend/src/app/slides/yorkie-slides-store.ts` — Yorkie ↔ Store adapter
- [x] 4.2 Equivalence tests: `MemSlidesStore` vs `YorkieSlidesStore` for identical op sequences
- [x] 4.3 Presence schema (`SlidesPresence`) + drag broadcast (60 fps), commit on mouseup
- [x] 4.4 Peer cursors / selection rings (reuse sheets/docs visuals)
- [x] 4.5 Backend `SlidesDocument` Yorkie type in `packages/backend/src/yorkie/yorkie.types.ts`
- [x] 4.6 Frontend `DocumentType` extension + lazy `SlidesView` route
- [x] 4.7 `documents/document-detail.tsx` — `type === 'slides'` branch
- [x] 4.8 `tests/helpers/two-user-slides-yorkie.ts` + concurrent add/move/delete suite
- [x] 4.9 verify:integration green (Postgres + Yorkie)

## Phase 5: Text + Present + Export + CLI

- [x] 5.1 `view/editor/text-box-editor.ts` — docs `initializeTextBox` bridge, double-click → mount → blur commit
- [x] 5.2 ~~Yorkie Tree wiring for `TextElement.data.blocks` and `Slide.notes`~~ — reverted: nested `Tree` inside an array element gets JSON-serialised by Yorkie, no CRDT semantics. Bodies/notes stay as plain `Block[]` JSON; commits resolve LWW on blur. Per-keystroke convergence deferred to Phase 5a-2 (root-level `textTrees: { [elementId]: Tree }` map keyed by id).
- [ ] 5.3 Image input paths — upload, drag-drop, clipboard paste (workspace image API reuse)
- [x] 5.4 Slide-canvas text painting via docs `paintLayout` — same baseline math + font path as the in-place editor. Slide-side CJK font registry shim was dropped because the editor itself relied on docs' `buildFont` and Korean rendered fine; if a missing-glyph case surfaces later, route through `resolveFontFamily` at the docs level so both surfaces benefit.
- [x] 5.5 `view/present/presenter.ts` + `presentation-mode.tsx` — fullscreen, fit-to-screen, key nav
- [x] 5.6 `export/pdf.ts` — 13.333"×7.5" page mapping. **Shipped as P0
      raster** (PR #395, [`20260621-slides-pdf-export-todo.md`](./20260621-slides-pdf-export-todo.md)):
      reuses `drawSlide()` → high-DPI offscreen canvas → one bitmap/page,
      rather than delegating vector font/embedding to docs (docs'
      `PdfPainter` can't paint slide shapes/connectors/effects). Vector
      text + docs font-embedding delegation deferred to P1.
- [ ] 5.7 `packages/cli/src/commands/slides.ts` — list/create/delete/content/export-pdf
- [ ] 5.8 `packages/backend/test/slides-cli-roundtrip.e2e-spec.ts`
- [x] 5.9 `verify:browser:docker` adds slides scenario (thumbnails + present)
- [ ] 5.10 verify:full green

## Cross-Cutting

- [x] Update `docs/design/README.md` — Slides section (done in spec commit)
- [ ] Update `packages/frontend/README.md` for slides route
- [x] Add `packages/slides/README.md`
- [ ] Visual companion brainstorm session archived in `.superpowers/brainstorm/` (gitignored)

## Verification gates (per spec)

- End of P1, P2, P3: `pnpm verify:fast`
- End of P4: `pnpm verify:integration`
- End of P5: `pnpm verify:browser:docker`, `pnpm verify:full`

## Out of v1 (see "Future parity with Google Slides" in spec)

**v1.1:** align/distribute toolbar, hyperlinks on shapes/images,
external-URL image embed, fixed text-box height toggle.

**v2:** group/ungroup, speaker-notes presenter view, animations &
transitions, theme system & master slides, PPTX export, comments,
mobile zoom-to-fit, per-slide Yorkie docs (lazy loading for 100+ slide
decks), right-side Format Options panel, slide/element CRUD REST
endpoints.

**Not currently planned:** PPTX import, embedded sheets/charts,
audience tools (Q&A, polls).
