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

- [x] **A1.** `@@index([visibility, status, publishedAt])` + migration. The
      `sort=recent` branch of `browse()` orders by `publishedAt desc, id desc`
      and has no index; only the `useCount` sort does.
- [x] **A2.** Refuse to publish a document whose root holds a `datasource` /
      `lakehouse` tab. Such a tab copied across a workspace boundary lands
      inert (`TabMeta.datasourceId` resolves to nothing there), which is the
      limitation #1000's review found and deferred to here.
      `template-content-guard.ts` is the pure scan; `assertContentIsShareable`
      reads only `sheet` documents and fails closed on an unreadable one.
- [x] **A3.** Backend e2e coverage through the HTTP layer
      (`packages/backend/test/template.e2e-spec.ts`), alongside the existing
      service-level unit tests. 18 cases.
- [x] **A4.** A workspace owner may unpublish any listing in their workspace.
      Already true through `isDocumentManager`; asserted at both the unit and
      HTTP levels rather than reimplemented.

## B. Phase 2b — thumbnails

- [x] **B1.** `src/lib/thumbnail-capture.ts`: a document-id-keyed registry of
      capture sources plus the downscale/encode step (longest edge 640 px,
      WebP with a PNG fallback). In `lib/` because the architecture lint
      forbids `components/` from importing `@/app/*`, and the Share dialog is
      the consumer.
- [x] **B2.** `slides` registers an **offscreen** capture of slide 1 through
      the exported `renderThumbnail` (`slides-thumbnail.ts`), so publishing
      from slide 7 still yields the deck's cover.
- [x] **B3.** `doc`, `sheet` and `board` register a **live-canvas** composite —
      see *Deviations* below.
- [x] **B4.** Capture → `POST /images` → store the returned **id** at publish
      time, and an explicit *Update preview* button for a refresh. A failed
      capture or upload never fails the publish, and is omitted from a
      republish rather than sent as null.
- [x] **B5.** The gallery card renders the thumbnail; `imageUrl` in
      `api/images.ts` replaces the landing page's private `thumbnailUrl`.

## Deviations from the design's thumbnail table

The design table named an offscreen source per type. Three arms read the live
editor canvas instead, and two capture nothing:

- `doc` and `sheet` export no offscreen page/grid renderer — the paint path is
  private to the mounted editor (`packages/docs/src/view/editor.ts`,
  `packages/sheets/src/view/gridcanvas.ts`). Exporting one is a larger change
  than the thumbnail justifies, and the editor canvas is the *same* renderer,
  so the pixels are right; only the framing differs (the current scroll
  position rather than page 1 / the used range).
- `board` is an unbounded plane with no first page, so the live canvas is the
  right source permanently, not a shortcut.
- `pdf` and `image` capture nothing in this pass. Both are blob viewers whose
  value as a template is marginal, and both would need a separate decode path.

The design doc is updated to say this rather than leaving the table
aspirational.

## Known limitation, and the follow-up it earns

**A document holding a remote image gets no thumbnail.** The editors load
images without `crossOrigin` (deliberately — see `app/docs/image-insert.ts`),
which taints the canvas and makes `toBlob` throw. Caught, answered with `null`,
card falls back to the type icon.

The fix is to load our *own* bucket's images in CORS mode with a
no-`crossOrigin` retry on error, so a missing header degrades to today's
behavior. That touches the shared image loaders in three engine packages and
the main render path of every document, which is why it is not in this PR.

## Verification

- [ ] `pnpm verify:fast`
- [ ] Backend e2e with `RUN_DB_INTEGRATION_TESTS=true`
- [ ] Manual smoke in `pnpm dev`: publish a sheet, a doc, a deck and a board;
      confirm each card in the workspace Templates tab shows its own picture

## Review

_(filled in before merge)_
