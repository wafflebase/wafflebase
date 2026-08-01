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
  counted in an `ImportReport` surfaced to the user — never silently dropped.
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
        │  returns { items: MiroItem[], report }   (images already re-hosted)
        ▼
packages/board/src/import/miro/  NEW  PURE mapper (no HTTP, no secrets)
  ├─ map-items.ts   mapMiroItems(items): { inits: ElementInit[]; report }
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
   with a stable wafflebase one. Failures degrade to a skipped item + a report
   entry, never a failed import.
5. **Return** `{ items, connectors, report }`. The token is not echoed, not stored, not
   logged. Miro auth/permission errors map to 401/403/404 with a clear message.

### The mapper (`mapMiroItems`)

Pure, two-pass, mirroring `parseSpTree`'s structure:

1. **Pass 1** — assign a wafflebase element id to every mappable item and
   record `miroId → elementId`, so connectors can resolve targets regardless of
   order.
2. **Pass 2** — build one `ElementInit` per item.

| Miro item | → board element |
| --- | --- |
| `sticky_note` | SP2's sticky: `roundRect` shape, Miro **named** `style.fillColor` (`yellow`, `light_green`, …) → hex via a lookup table, `data.content` as the text, middle-anchored |
| `shape` | `ShapeElement` — Miro `shape` name → `ShapeKind` (`rectangle`→`rect`, `circle`→`ellipse`, `triangle`, `round_rectangle`→`roundRect`, `rhombus`→`diamond`, …; unknown → `rect` + report), fill / border color / border width, inline text |
| `text` | `TextElement` with a docs `Block[]` body |
| `connector` (separate feed) | `ConnectorElement` — `startItem.id`/`endItem.id` → `attached` endpoints via the id map; **both ends must resolve**, otherwise the connector is skipped + reported (Miro exposes no absolute coordinate for an unmapped end, so no honest fallback position exists — anchoring it anywhere would either strand the line at the world origin or invent geometry); `shape` (`straight`/`elbowed`/`curved`) → `routing`; arrowheads from `style.startStrokeCap`/`endStrokeCap` |
| `image` | `ImageElement` with the re-hosted `data.src` |
| `frame` | `rect` shape (light fill, visible border) + the frame title as its text — a labelled region, not a container |
| `card` / `app_card` | `roundRect` shape whose text body is the title plus the description |
| everything else | skipped, counted by type in the report |

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

### UX

"Import from Miro…" joins the existing Import menu in the documents list. The
dialog takes a token and a board URL, links to Miro's token docs, and states
plainly that the token is used once and never stored. On submit: a progress
state (fetching → mapping → creating), then navigate to `/b/:id`. If the
report is non-empty, a summary lists what was skipped and why. Errors are
shown inline in the dialog, which stays open so the input isn't lost.

### Testing

- **Mapper** (the core surface) — JSON fixtures per item type asserting the
  produced `ElementInit`: sticky color/text, shape-kind + fill mapping,
  center→top-left + degrees→radians geometry, connector `attached` resolution
  via the id map **and** the missing-target `free` fallback, frame/card
  approximations, and unsupported types landing in the report.
- **Backend** — board-URL/id parsing (valid, bare id, garbage), pagination
  following `links.next`, the item ceiling, image re-upload success and
  failure-degrades-to-report, and Miro error-status mapping. Miro `fetch` is
  mocked; no live API calls in tests.
- **Applier** — the `board` branch produces the expected `root.elements` in one
  batch.
- **Security assertion** — a test that the response payload and logs never
  contain the token.

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
  import; the ceiling bounds the worst case.
