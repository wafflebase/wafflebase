---
title: board-miro-import
target-version: 0.6.3
---

# Board — Miro Import (SP3)

## Summary

SP3, the final sub-project of the [board infinite canvas](board.md), imports a
Miro board into a new wafflebase **board** document as native elements —
sticky notes, shapes, text, connectors, images, frames, and cards.

The import is **structured, not a screenshot**: it reads the Miro REST v2
`GET /boards/{id}/items` feed **plus** the separate
`GET /boards/{id}/connectors` feed (connectors are not part of the items
response) and maps each entry to the board's element model
(which is the slides `Element` union). It reuses three shipped seams rather
than inventing new machinery:

- **The PPTX importer's shape** — a pure `sourceItems → Element[]` mapper with
  an id map so connectors can resolve their endpoints
  (`packages/slides/src/import/pptx/shape.ts` is the reference).
- **The datasource connector's secret discipline** — the Miro token is used
  **server-side only** and never reaches the CRDT, the frontend state, or the
  database. Unlike a datasource, it is **not stored at all**: SP3 is a
  one-shot import, so the token lives only for the duration of one request.
- **The headless import applier** — `applyImportedContent()`
  (`packages/frontend/src/app/documents/apply-imported-content.ts`) already
  persists a client-parsed import into a Yorkie document with no editor
  mounted. SP3 adds its `board` branch.

A sticky note maps onto SP2's preset-`roundRect` sticky, so the highest-value
Miro item type costs almost nothing to support.

## Goals / Non-Goals

### Goals

- **Import a Miro board into a new board document** from the documents list:
  "Import from Miro…" → paste a Miro **access token** + **board URL** → a new
  `"board"` document is created, populated, and opened at `/b/:id`.
- **Map the item types that carry a whiteboard's meaning:**
  `sticky_note`, `shape`, `text`, `connector`, `image`, plus `frame` and
  `card`/`app_card` as best-effort approximations.
- **Never leak the token.** It is posted once to the backend over TLS, held in
  memory for that request, and discarded. It is never persisted, logged, echoed
  back, or written into the document.
- **Report what didn't come across.** Unsupported item types are skipped and
  counted and surfaced to the user — never silently dropped. Three channels
  reach the summary: the mapper's `skipped` / `approximated`, the applier's
  `droppedConnectors`, and the backend's `notes`.
- **No regression to slides or to SP1/SP2 board behavior.** SP3 adds a new
  backend module, a new pure mapper, and one new branch in the import applier.

Success = pasting a token + board URL produces a new board whose stickies,
shapes, text, connectors, images, frames, and cards are laid out as they were
in Miro, with a summary of anything skipped, and `pnpm verify:self` green.

### Non-Goals (SP3)

- **OAuth 2.0 / a "Connect Miro" app.** SP3 is token-paste only. No stored
  connection, no refresh tokens, no Prisma model, no connection-management UI.
  (An OAuth flow is the natural follow-up; nothing here forecloses it.)
- **Two-way sync, re-import, or diffing.** Import is one-shot and one-way.
- **Importing into an existing board.** SP3 always creates a new document.
- **Faithful `document` / `embed` / `mindmap` / `tag` reproduction.** Skipped
  and reported.
- **Miro-specific semantics that have no board equivalent:** frames as true
  containers (a frame becomes a labelled rectangle, not a parent), sticky
  "tags", comments, cursors/presence, board thumbnails.
- **Preserving Miro image crop / filters.** The image is imported as-is.

## Proposal Details

### Architecture

```text
packages/frontend/src/app/documents/
  ├─ miro-import-dialog.tsx   NEW  token + board URL form, progress, report
  └─ apply-imported-content.ts   + `board` branch (headless Yorkie apply)
        │  POST /workspaces/:wid/miro/import  { token, boardUrl }
        ▼
packages/backend/src/miro/     NEW  thin authenticated proxy (token never stored)
  ├─ miro.controller.ts        workspace-scoped + assertMember (datasource pattern)
  ├─ miro.service.ts           board-URL→id, paginated item fetch, image re-upload
  └─ miro.types.ts             the MiroItem subset we read
        │  returns { items, connectors, notes }    (images already re-hosted)
        ▼
packages/board/src/import/miro/  NEW  PURE mapper (no HTTP, no secrets)
  ├─ map-items.ts   mapMiroItems({items, connectors, resolveImageUrl})
  │                   → { inits, skipped, approximated }
  ├─ geometry.ts    Miro center+size+deg → board Frame {x,y,w,h,rotation(rad)}
  └─ shape-kind.ts  Miro shape name → slides ShapeKind
        │  imports the element model from
        ▼
@wafflebase/slides   Element / ElementInit / ShapeKind — REUSED unchanged
```

**Why the split.** The token is a secret, so the Miro call is backend-only —
the same discipline `DataSourceService` uses (`decrypt` at the point of the
outbound call, never toward the client). The mapper has no I/O and no secrets,
so it is a pure function in `@wafflebase/board`, unit-testable against JSON
fixtures — mirroring how `importPptx` is a pure package function that takes an
injected `uploadImage`. The document creation + persistence path is the one
already used by xlsx/docx/pptx import.

### Backend proxy (`POST /workspaces/:wid/miro/import`)

JWT-guarded and `assertMember`-gated, exactly like the datasource controller.
Body: `{ token: string; boardUrl: string }`. Steps:

1. **Parse the board id** out of the pasted URL
   (`https://miro.com/app/board/<id>/...`); accept a bare id too. Reject
   anything else with a 400 naming the expected shape.
2. **Fetch items**, paginated: `GET https://api.miro.com/v2/boards/{id}/items?limit=50`
   with `Authorization: Bearer <token>`, following the `cursor` until
   exhausted, capped at a **hard item ceiling** (see Risks) so a huge board
   cannot exhaust memory. `limit` is capped at 50 by the API.
3. **Fetch connectors** from the separate paginated endpoint
   `GET /v2/boards/{id}/connectors` — connectors are **not** returned by
   `/items`, so a board's arrows would silently vanish without this second
   call.
4. **Re-host images.** A Miro image's `data.imageUrl` requires the bearer
   token and **expires after ~60 seconds**, so it is useless in a persisted
   document. For each image the service fetches the bytes *with the token,
   immediately* (appending `format=original`) and re-uploads them through the
   existing `ImageService` into the workspace image bucket, replacing the URL
   with a stable wafflebase one. Failures degrade to a skipped item + a note,
   never a failed import.

   `data.imageUrl` is the one value in this flow the backend does not choose —
   it arrives inside upstream board JSON — so the download is gated before the
   request exists: **https only**, **host on a Miro allowlist** (exact
   `miro.com`/`api.miro.com`, or a true `*.miro.com` subdomain), and the body
   read in **capped chunks** against the same 10 MB ceiling `ImageService`
   enforces. Without the gate the backend would fetch any host named there
   from inside the deployment network *with the user's live Miro credential
   attached*, and would buffer the whole response before the upload's own size
   check could run. A refused host or an oversize body degrades to the same
   `image-failed` note as any other download failure.

   The per-image cap bounds one download, not the phase. Since a board may
   carry thousands of images, the re-hosting phase also has **aggregate
   ceilings** — a maximum number of downloads and a maximum total byte count —
   past which the remaining images are skipped *without being fetched* and
   reported under their own `image-budget` note (kept distinct from
   `image-failed`: nothing malfunctioned, the board is simply too image-heavy
   for one import).

   The downloads run through a **bounded-concurrency pool**
   (`IMAGE_CONCURRENCY = 6`) rather than one at a time: every one of them is a
   network wait, so a serial loop leaves the connection idle for essentially
   the whole of the slowest phase. 6 caps peak memory at
   `6 x MAX_IMAGE_BYTES` = 60 MB — an unbounded `Promise.all` over 100 images
   would be 1 GB — and stays far under Miro's 1000 req/min. Two invariants are
   load-bearing:

   - **Output order is unchanged.** Results are written back **by index** and
     the holes compacted; they are never pushed in completion order.
     `mapMiroItems` builds its id map and its frames-behind-contents z-order by
     walking this array, so a reshuffle would silently change the document.
   - **The count ceiling stays exact** — charged at dispatch, after the host
     check and before the first `await`, so no two workers can claim the same
     slot and a refused host still costs no budget. The **byte** ceiling is
     charged against *completed* downloads, so a pool can overshoot it by at
     most `(IMAGE_CONCURRENCY - 1) x MAX_IMAGE_BYTES` before it trips.
     Reserving 10 MB per in-flight slot instead would skip images that
     comfortably fit, which is the worse failure.

   Every outbound call carries a **deadline** (`AbortSignal.timeout`; the image
   download combines it with the size-cap controller via `AbortSignal.any`).
   Node's `fetch` applies none of its own, so without this a host that accepts
   the connection and then stalls holds a request worker indefinitely — and the
   paginated loop can issue one such call per page.
5. **Return** `{ items, connectors, notes }`. The token is not echoed, not stored,
   not logged. Miro auth/permission errors map to 401/403/404 with a clear message.

   The board id is parsed off a **parsed `URL.hostname`**, not by searching the
   raw string: an unanchored match accepts `https://evil.com/miro.com/app/board/<id>`
   and hands back an id sourced from someone else's link.

### The mapper (`mapMiroItems`)

Pure, two-pass, mirroring `parseSpTree`'s structure:

1. **Pass 1** — assign a wafflebase element id to every mappable item and
   record `miroId → elementId`, so connectors can resolve targets regardless of
   order. An item that cannot produce an element at all (an `image` with no
   `imageUrl`) is counted as skipped **here**, before an id is minted: a
   connector pointing at a registered-but-never-emitted item would otherwise
   resolve to a live handle and be emitted `attached` to nothing.
2. **Pass 2** — build one `ElementInit` per item.

| Miro item | → board element |
| --- | --- |
| `sticky_note` | SP2's sticky: `roundRect` shape, Miro **named** `style.fillColor` (`yellow`, `light_green`, …) → hex via a lookup table, `data.content` as the text, middle-anchored |
| `shape` | `ShapeElement` — Miro `shape` name → `ShapeKind` (`rectangle`→`rect`, `circle`→`ellipse`, `triangle`, `round_rectangle`→`roundRect`, `rhombus`→`diamond`, …; unknown → `rect`, counted under `approximated`, not `skipped` — the shape IS imported), fill / border color / border width, inline text |
| `text` | `TextElement` with a docs `Block[]` body |
| `connector` (separate feed) | `ConnectorElement` — `startItem.id`/`endItem.id` → `attached` endpoints via the id map; **both ends must resolve**, otherwise the connector is skipped + reported (Miro exposes no absolute coordinate for an unmapped end, so no honest fallback position exists — anchoring it anywhere would either strand the line at the world origin or invent geometry); `shape` (`straight`/`elbowed`/`curved`) → `routing`; arrowheads from `style.startStrokeCap`/`endStrokeCap` |
| `image` | `ImageElement` whose `data.src` is the re-hosted URL passed through the **injected `resolveImageUrl`**. The backend's URL is root-relative (`/api/v1/workspaces/:wid/images/:id`) and the SPA and API sit on different origins in every environment, so a relative src persisted into the CRDT 404s forever. The resolver is injected (and required, not defaulted) to keep this package free of env concerns while making the omission a compile error — the native upload path applies the same function |
| `frame` | `rect` shape (light fill, visible border) + the frame title as its text — a labelled region, not a container. **Emitted before every other element** so it sits behind them: it is an opaque rectangle and z-order is array order, so a frame arriving late in `/items` would paint over the items it delimits |
| `card` / `app_card` | `roundRect` shape whose text body is the title plus the description, each **HTML-escaped** before being wrapped in `<p>` (they arrive as plain text; interpolated raw, a `<` or a literal `</p><p>` reparses as markup and silently restructures the content) |
| everything else | skipped, counted by type in `skipped` |

Two report channels, deliberately distinct: `skipped` counts what is **absent**
from the document, `approximated` counts what is **present but degraded**
(today only `shape-kind`, an unrecognized Miro shape imported as a `rect`).
Folding the second into the first told the user content was missing when it
was not, under a Miro item type that does not exist.

**Geometry.** Miro positions items by **center** with `geometry {width,
height, rotation?}` in degrees; the board's `Frame` is top-left + radians:
`x = position.x - width/2`, `y = position.y - height/2`,
`rotation = (rotation ?? 0) * Math.PI / 180`. The board plane is unbounded, so
coordinates map **1:1** with no scaling. Items sit where Miro had them, and
the existing viewport lands the user on the content.

**HTML content.** Miro item text (`data.content`) is an HTML fragment — Miro
documents `<p>`, `<a>`, `<strong>`, `<b>`, `<em>`, `<i>`, `<u>`, `<s>`,
`<span>`, `<br>` (text items additionally allow `<ol>`/`<ul>`/`<li>`). SP3
parses a conservative subset — paragraph breaks plus bold/italic/underline/
strikethrough — into docs `Block[]`; every other tag degrades to its text
content. Rich-text fidelity is explicitly best-effort.

### Persistence (headless)

`ImportedContent` gains a `board` variant carrying the mapped
`ElementInit[]`, and `applyImportedContent` gains the matching branch:
attach to `board-<id>` with `initialBoardRoot()`, construct a
`YorkieBoardStore` over the attached doc, and run **one**
`store.batch(() => { for (const init of inits) store.addElement(SYNTHETIC_SLIDE_ID, init) })`
— a single Yorkie change and a single undo unit, with connector-frame
computation and text normalization handled by the store rather than
reimplemented. Then detach.

Driving the store (rather than writing `r.elements` directly, as the slides
branch does for `r.slides`) is deliberate: connector frames and text/connector
normalization already live in `addElement`.

**The id remap is load-bearing.** The ids the mapper wired connectors to are
NOT the ids the document gets. `mapMiroItems` mints its own handles and carries
them on a non-model `__id`; `addElement` mints a *fresh* id and returns it, and
that one wins. So `applyBoardElements` runs **two passes inside the one batch**:

1. add every **non-connector** element, building `Map<__id, realId>` from
   `addElement`'s return value;
2. add the **connectors**, rewriting each `attached` endpoint's `elementId`
   through that map.

The split is driven off `el.type === 'connector'`, never off array order —
connectors come from a separate feed with no ordering guarantee against their
targets. Writing the mapper's `__id` through verbatim (the first shipped
behavior) anchored every connector to an element no document contained;
`resolveEndpoint` falls back to `(0, 0)` for an unresolvable attached id, so
every arrow collapsed into a ~1×1 frame at the world origin — invisible,
nowhere near the content, and reported to the user as a clean import.

A connector whose endpoint fails to remap is **dropped and counted**, never
written dangling. The mapper guarantees both ends resolve, so the count should
always be zero; `applyBoardElements` returns `{ droppedConnectors }` anyway and
the dialog folds a non-zero value into the summary, because a silent drop is
the one outcome this flow exists to prevent.

### UX

"Import from Miro…" joins the existing Import menu in the documents list. The
dialog takes a token and a board URL, links to Miro's token docs, and states
plainly that the token is used once and never stored. On submit: a progress
state (fetching → mapping → creating), then navigate to `/b/:id`. If any
report channel is non-empty, a summary lists what did not come across and why.
Errors are shown inline in the dialog, which stays open so the input isn't lost.

The token field is `type="password"` **plus `autoComplete="off"`** — a bare
password input prompts the browser to save a credential the copy directly above
it promises is never stored.

Document creation and the apply are two steps, so a failed apply would otherwise
leave an empty "Imported Miro board" behind, and pressing Import again would add
another. The dialog **deletes the just-created document** when the apply throws
(best-effort — a failed delete must not replace the error worth reporting), so
retrying cannot accumulate orphans.

### Testing

- **Mapper** (the core surface) — JSON fixtures per item type asserting the
  produced `ElementInit`: sticky color/text, shape-kind + fill mapping,
  center→top-left + degrees→radians geometry, connector `attached` resolution
  via the id map, connectors with an unmapped end being **skipped and counted**
  (there is no `free` fallback — see the connector row above), frame/card
  approximations, card HTML escaping, frames-before-contents ordering, the
  image URL passing through the injected resolver, and unsupported types
  landing in `skipped`.
- **Backend** — board-URL/id parsing (valid, bare id, garbage, and a
  path-embedded `miro.com` that must be rejected), cursor pagination, the item
  ceiling, the stalled-cursor guard, image re-upload success and
  failure-degrades-to-note, the image-host allowlist (a non-Miro host is
  refused **without a fetch of that host and without the token**) and the size
  cap, and Miro error-status mapping. Miro `fetch` is mocked; no live API calls
  in tests. Concurrency adds: a mixed success/failure batch whose completion
  order is forced to be the *reverse* of feed order still emits items in feed
  order, and the in-flight count is `> 1` but never `> IMAGE_CONCURRENCY`. The
  byte ceiling is asserted as a **bound**, not an exact count — pinning the
  count would be pinning the scheduler.
- **Applier** — the `board` branch produces the expected `root.elements` in one
  batch, with connector endpoints remapped onto the store's real ids and
  unresolvable connectors dropped + counted. Its store double **must mint a
  distinct id per call**: a constant-id stub cannot distinguish a remapped
  endpoint from an un-remapped one, which is exactly how the remap bug shipped
  past a green suite.
- **Composition** — one test crossing all three layers
  (`miro-import-composition.test.ts`): a realistic backend-shaped payload →
  `mapMiroItems` → `applyBoardElements` against a **real in-memory
  `MemSlidesStore`**, asserting that every connector endpoint's `elementId`
  exists among the written elements and that the image `src` is absolute.
  Layer-local suites were each green while the composition was broken; this is
  the test that catches that class of defect, and it must not be reduced to
  stubs.
- **Security assertion** — a test that the response payload never contains the
  token.

## Risks and Mitigation

- **The token is a live credential.** *Mitigation:* backend-only, never
  persisted, never logged, never returned; TLS in transit; the dialog states
  the lifetime. A user-supplied token also means no app-level Miro secret to
  manage. Follow-up OAuth would replace the paste, not the architecture.
- **Large boards.** Thousands of items could exhaust backend memory or produce
  an unusable document. *Mitigation:* a hard item ceiling with the truncation
  **reported, never silent**; the board renderer already culls off-screen
  elements (SP1), and the minimap (SP2) makes a large import navigable. A
  spatial index stays deferred, consistent with SP1/SP2.
- **Rate limits.** `GET /items` is a Level 2 endpoint (100 credits/call,
  1000 req/min). *Mitigation:* `limit=50` (the API max) minimizes calls, and a
  `429` surfaces as a clear retryable error rather than a partial import.
- **Miro API drift.** v2 item shapes may change. *Mitigation:* the mapper reads
  a narrow, explicitly-typed subset and treats unknown types/fields as
  skip-and-report rather than throwing, so drift degrades instead of breaking.
- **Fidelity expectations.** Users may expect a pixel-perfect copy.
  *Mitigation:* the report is part of the flow, not an afterthought — every
  skipped item and approximation is named. Frames and cards are documented as
  approximations.
- **Image re-hosting cost.** Fetch + re-upload per image is the slowest step.
  *Mitigation:* failures degrade to a reported skip rather than failing the
  import; the ceiling bounds the worst case; and the downloads run through a
  6-wide pool instead of serially, which is where most of the wall clock went.
