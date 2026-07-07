# Documents List — Sort, Filter & Last-Modified

Improve how users **sort and find** documents on the documents-list screen
(`packages/frontend/src/app/documents/document-list.tsx`, shared by the
global `/documents` page and per-workspace `workspace-documents.tsx`).

Single PR. **No schema change, no migration.** Thumbnails / grid view and
favorites are explicitly deferred to follow-up PRs.

## Context — current state

- One shared `DocumentList` (TanStack Table). Data is fetched whole and all
  sorting/filtering/pagination is **client-side** over the full array.
- Columns today: Title (+type icon), Editing (presence avatars), **Created
  At** (relative), Actions. Rows poll every 5 s for presence.
- Search: a single "Filter by title…" input, **title only** (NFC-normalized
  lowercase substring).
- Sorting: TanStack `getSortedRowModel` + `sorting` state are wired, but **no
  header is clickable**, so sorting is unreachable in the UI. Default order is
  `createdAt desc` (hardcoded server-side).
- No `updatedAt` on the Prisma `Document` model; no owner column shown; no
  favorites/folders/tags. Organizational unit = Workspace only.

Backend list endpoints: `GET /documents` and
`GET /workspaces/:id/documents` (`document.controller.ts`), both
`orderBy: createdAt desc` then `attachEditors()` merges live Yorkie presence.

## Key finding — last-modified comes from Yorkie, for free

Content lives in Yorkie, not Postgres — frontend edits bypass NestJS, so
there is no `updatedAt` write path and adding a column would need webhooks or
a client ping (net-new, racy). **Not needed:** the backend already calls the
Yorkie admin `AdminService/GetDocuments` RPC (in `attachEditors` via
`YorkieAdminService`), and its `DocumentSummary` response already carries
`updated_at` (field 6) alongside the `key`/`presences` we already parse.
So "last modified" is **one extra field on a response we already fetch** —
no schema change, no write path.

- `updated_at` = bumped on document changes (use this).
- `accessed_at` = bumped on any access (do **not** use for "modified").
- Verify behaviorally that presence-only changes don't bump `updated_at`; if
  they do, note it as a known limitation (acceptable for v1).

## Scope — 4 features, one PR

### 1. Expose sorting (frontend)
- [x] Make column headers clickable to toggle sort: **Title, Last modified,
  Created, Type**. Presence column stays `enableSorting: false`.
- [x] Show sort-direction affordance (asc/desc arrow) on the active header.
- [x] Add a sort dropdown for discoverability/mobile: "Last modified /
  Title A→Z / Created". Dropdown and header clicks drive the same `sorting`
  state (single source of truth).
- [x] **Default sort = Last modified, desc** (matches Google Drive), instead
  of the current created-desc.

### 2. Search + type filter (frontend)
- [x] Type filter chips next to the search box: Sheet / Doc / Slides,
  multi-select toggle. Empty selection = all types.
- [x] Keep the text filter **title-only** (NFC-normalized, lowercase) — type
  filtering is the chips' job, so widening search to type keywords would
  flood results on type-name collisions.

### 3. Last-modified column (backend read-only + frontend)
- [x] Extend `GetDocumentsResponse` in `yorkie-admin.service.ts` (types at
  ~:20-26) to parse `updated_at` (and keep the door open for `accessed_at`).
  Parse the RFC3339 / `google.protobuf.Timestamp` into a `Date`/ISO string.
- [x] Return `{ editors, updatedAt }` per doc key (extend `getEditors` or add
  a sibling method); `attachEditors` attaches `updatedAt` to each list item.
- [x] **Fallback to `createdAt`** when Yorkie has no summary for a doc
  (never-attached docs, or `YORKIE_SECRET_KEY` unset) — reuse the existing
  silent-degrade path that presence already uses.
- [x] Frontend: add a **"Last modified"** column
  (`formatDistanceToNow`), sortable, and make it the default sort key.
- [x] Keep the "Created" column (now a secondary, opt-in sort).

### 4. Owner column (backend select + frontend)
- [x] Add the `author` relation (username, photo) to the `select` of both
  list endpoints so it's returned without an extra round-trip.
- [x] Extend the frontend `Document`/list-item type with `author`.
- [x] Frontend: add an **Owner** column (avatar + name), sortable by name.
- [x] Handle null author gracefully (legacy docs with `authorID = null`).

## Out of scope (follow-up PRs)
- **Thumbnails / grid view** — needs render-to-image + storage; separate PR.
  (Feasibility scouted; capture findings when that PR starts.)
- **Favorites (starred)** — the only piece needing a new table
  (`Favorite` user↔document join) + migration; deferred to keep this PR
  migration-free.
- Folders / tags; server-side sort/search/pagination query params (service
  layer already supports `orderBy`/`where`/`skip`/`take` when scale demands).

## Test plan
- [x] Unit: search/filter/sort predicates over a fixture doc set (title +
  type match; type-chip filtering; each sort key + direction; default =
  last-modified desc).
- [x] Backend: `YorkieAdminService` parses `updated_at` from a
  `GetDocuments` response fixture; `attachEditors` falls back to `createdAt`
  when a summary is missing / key unset. Owner `select` returns author.
- [x] Manual smoke (`pnpm dev`): create sheet/doc/slides, edit one, confirm
  it jumps to the top under default sort; toggle each header + dropdown;
  filter by type chips; search by title and by type; owner avatar renders;
  works both on `/documents` and a workspace page; degrades cleanly with
  `YORKIE_SECRET_KEY` unset.
- [x] `pnpm verify:fast` green before each commit.

## Key files
- `packages/frontend/src/app/documents/document-list.tsx` (table, sort,
  filter, columns)
- `packages/frontend/src/app/documents/page.tsx`,
  `packages/frontend/src/app/workspaces/workspace-documents.tsx` (fetch)
- `packages/frontend/src/types/documents.ts` (list-item type)
- `packages/backend/src/yorkie/yorkie-admin.service.ts` (parse `updated_at`)
- `packages/backend/src/document/document.controller.ts`
  (`attachEditors`, list endpoints, author `select`)

## Review

Shipped as PR #448 ("Add sorting, type filter, last-modified & owner to
documents list"). All four features landed in one migration-free PR:

1. **Sorting exposed** — column headers (Title / Last modified / Created /
   Type) are clickable with an asc/desc affordance, plus a sort dropdown
   for discoverability; both drive one `sorting` state. Default is
   **Last modified desc**.
2. **Search + type filter** — Sheet/Doc/Slides multi-select chips beside a
   title-only (NFC-normalized) search box; predicate logic extracted to
   `document-list-utils.ts` and unit-tested.
3. **Last-modified column** — read from the Yorkie admin `GetDocuments`
   `DocumentSummary.updatedAt` the backend already fetches for presence (no
   schema change, no write path); falls back to `createdAt` when Yorkie has
   no summary or `YORKIE_SECRET_KEY` is unset.
4. **Owner column** — `author` (username, photo) added to both list
   endpoints' `select`; avatar+name column, sortable, null-author safe.

Two review catches are captured in the lessons file: (a) Yorkie admin
`GetDocuments` marshals proto3 **camelCase** (`updatedAt`), so the initial
snake_case read silently fell back to `createdAt` for every row — fixed
with `updatedAt ?? updated_at` + a `projectSummary` regression test; and
(b) three e2e specs stub `YorkieAdminService` and had to gain the new
`getSummaries` method. Follow-ups (thumbnails / grid view, favorites)
remain out of scope with feasibility scouted in the lessons file.
