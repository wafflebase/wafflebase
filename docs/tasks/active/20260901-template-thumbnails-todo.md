# Template gallery — Phase 2 leftovers + thumbnail capture

Status: in progress
Design: [`docs/design/template-gallery.md`](../../design/template-gallery.md)
Follows: [`20260901-template-gallery-todo.md`](20260901-template-gallery-todo.md)
(Phase 1 = #1000, Phase 2 = #1001)

## Why one task

Phase 2 shipped the gallery surfaces but left four holes inside its own scope,
and shipped the cards without the one thing a card is for — a picture. Both
halves land together because the leftovers are individually too small to
justify a PR each, and because the thumbnail is the reason anyone will look at
the gallery the leftovers are correcting.

## Scope

Phase 2 leftovers (backend) + Phase 2b thumbnail capture (frontend). Phase 3
— review pipeline, frozen-copy promotion, public browse, trust and safety —
stays out.

## A. Phase 2 leftovers

- [ ] **A1.** `@@index([visibility, status, publishedAt])` + migration. The
      `sort=recent` branch of `browse()` orders by `publishedAt desc, id desc`
      and has no index; only the `useCount` sort does.
- [ ] **A2.** Refuse to publish a document whose root holds a `datasource` /
      `lakehouse` tab. Such a tab copied across a workspace boundary lands
      inert (`TabMeta.datasourceId` resolves to nothing there), which is the
      limitation #1000's review found and deferred to here.
- [ ] **A3.** Backend e2e coverage through the HTTP layer
      (`packages/backend/test/template.e2e-spec.ts`), alongside the existing
      service-level unit tests.
- [ ] **A4.** A workspace owner may unpublish any listing in their workspace.
      Verify — `assertManager` already grants this through `isDocumentManager`
      — and lock it in with a test rather than writing new code.

## B. Phase 2b — thumbnails

- [ ] **B1.** `thumbnail-capture.ts`: a document-id-keyed registry of capture
      sources plus the downscale/encode step (~640 px wide, WebP).
- [ ] **B2.** `slides` and `board` register an **offscreen** capture through
      the exported `renderThumbnail` / `drawSlide`, so what is captured is the
      first slide (slides) or the content bounds (board), not the viewport the
      author happens to be looking at.
- [ ] **B3.** `doc` and `sheet` register a **live-canvas** capture — see
      *Deviation* below.
- [ ] **B4.** Capture → `POST /images` → store the returned **id** at publish
      time, and an explicit *Update thumbnail* action for a refresh. A failed
      capture or upload never fails the publish.
- [ ] **B5.** The gallery card renders the thumbnail; `thumbnailUrl` becomes
      one shared helper instead of the landing page's private copy.

## Deviation from the design's thumbnail table

The design table names an offscreen source per type. Two arms are captured from
the live editor canvas instead:

- `doc` and `sheet` export no offscreen page/grid renderer — the paint path is
  private to the mounted editor (`packages/docs/src/view/editor.ts`,
  `packages/sheets/src/view/gridcanvas.ts`). Exporting one is a larger change
  than the thumbnail justifies, and the editor canvas is the *same* renderer,
  so the pixels are right; only the framing differs (the current scroll
  position rather than page 1 / the used range).
- `pdf` and `image` capture nothing in this pass. Both are blob viewers whose
  value as a template is marginal, and both would need a separate decode path.

The design doc is updated to say this rather than leaving the table aspirational.

## Verification

- [ ] `pnpm verify:fast`
- [ ] Backend e2e with `RUN_DB_INTEGRATION_TESTS=true`
- [ ] Manual smoke in `pnpm dev`: publish a sheet, a doc, a deck and a board;
      confirm each card in the workspace Templates tab shows its own picture

## Review

_(filled in before merge)_
