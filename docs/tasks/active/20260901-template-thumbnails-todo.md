# Template gallery — Phase 2 leftovers + thumbnail capture

Status: complete
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
      capture sources plus the downscale/encode step (longest edge 1280 px,
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

## C. Tainted canvases (added mid-task, from smoke testing)

A document holding a remote image got **no thumbnail at all** — drawing an
image fetched without CORS taints the canvas and `toBlob` throws. Not a rare
case: the first real deck tested hit it.

- [x] `@wafflebase/core/image` — `loadImage`, requesting **credentialed** CORS
      for our own API origin and retrying once plainly if that is refused.
      `use-credentials`, not `anonymous`: the workspace image route authorizes
      on the session cookie, which `anonymous` does not send cross-origin, so
      it would be refused, fall back, and taint the canvas anyway while costing
      a round trip per image.
- [x] Third-party origins get **no CORS attempt at all** — most send no
      `Access-Control-Allow-Origin`, so asking would cost a failed request per
      image and end in the same tainted canvas. Their behaviour is unchanged.
- [x] Wired into the Slides, Docs and Sheets image caches; origins declared
      once in `main.tsx`.

Still uncoverable: a document referencing **another deployment's** bucket (a
deck imported with `https://api.wafflebase.io/...` URLs, opened locally). That
origin's allowlist does not include this one, so the retry renders it and the
canvas stays tainted.

## Verification

- [x] `pnpm verify:fast`
- [x] `pnpm verify:self` (adds every build, the frontend chunk gate and the
      doc-staleness gate)
- [x] Backend e2e with `RUN_DB_INTEGRATION_TESTS=true` — 18/18
- [x] Manual smoke in `pnpm dev` across sheet / doc / slides / board / note
- [x] Self code review over the full branch diff

## Review

Six commits. What the plan predicted, and what actually happened:

- **The registry was the right seam, and the architecture lint chose it.**
  `components/` may not import `@/app/*`, which made the direct call
  impossible; the indirection it forced is better than the call would have
  been. Same rule put `postSharedImage` in `api/` and removed a duplicate.
- **Every visual defect came from smoke testing, not from tests.** The wrong
  bucket key, the dark-mode white band, the crop, the resolution, notes having
  no preview — five findings, all from running it. The unit tests were green
  throughout. What the tests did do is make each fix cheap to land.
- **The largest single miss was diagnosability.** `captureThumbnail` swallowed
  every failure, so tracing one took a database query and a Yorkie dump.
  Adding one `console.warn` turned the next occurrence into a one-line answer —
  and the user found the taint case with it minutes later.
- **Code review caught three things smoke testing could not**, all of them
  about paths that do not run in the happy case: `crossOrigin="anonymous"`
  silently defeating the cookie-authorized image route (a regression, not just
  a missed benefit), the thumbnail being uploaded to a permanently public URL
  *before* the publish that justifies it was authorized, and the board minimap
  being composited into every board thumbnail because "chrome" was inferred
  from size rather than declared.
- **One test caught a lying mock.** The `update` mock spread the module-level
  constant rather than the test's own listing, so a field the caller never
  mentioned came back as its default — the opposite of what Prisma does. The
  thumbnail-replacement test failed against it, which is the mock being wrong
  and the test being right.
- **One cost not predicted:** the frontend chunk gate again (218 → 220), for
  two genuine shared-module hoists.
