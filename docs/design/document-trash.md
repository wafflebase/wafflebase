---
title: document-trash
target-version: 0.6.15
---

# Document Trash

## Summary

Deleting a document used to destroy it on the spot: the row went, its blob
went with it, and nothing could bring either back. A misclick on "Delete" in
the documents list was permanent. This adds a trash. Deleting now moves the
document to the trash — a nullable `Document.deletedAt` timestamp — and the
trash is where it can be restored or deleted for good. Blob cleanup moves to
the permanent delete, since a restorable document must keep its bytes.

The hard part is not the column, it is the invariant that comes with it: **a
trashed document is invisible everywhere a live one is visible.** That covers
every read path — lists, the document itself, share links, the Yorkie auth
webhook, templates, copy, file serving, analytics, notifications and the whole
`/api/v1` surface — and a single missed path is a trashed document that is
still readable or, worse, writable. So the invariant is enforced by two helpers
in one file, and every gated path is listed below.

### Goals

- `DELETE /documents/:id` and `POST /documents/delete` move documents to the
  trash instead of destroying them, with the same manager gate and the same
  response shapes.
- A workspace trash list, restore, and permanent delete (single and bulk).
- A trashed document answers exactly like a missing one on every surface that
  is not the trash: `404` on reads, a denial at the Yorkie webhook.
- Restoring a document brings back its share links and its template listing
  untouched; restoring one whose folder was deleted meanwhile lands it at the
  workspace root.
- The same contract on `/api/v1`: `DELETE` trashes, `?permanent=true`
  destroys, `POST .../restore` restores.

### Non-Goals

- **No automatic purge.** Trashed documents stay in the trash until somebody
  restores or deletes them. A retention job ("deleted after 30 days") needs a
  scheduler this backend does not have yet (the same gap
  [notifications.md](notifications.md) names for its retention), so the UI must
  not promise one. Trashed blob documents keep counting toward storage until
  they are deleted for good.
- **No trash for folders.** Deleting a folder stays non-destructive in the way
  [workspace-folders.md](workspace-folders.md) describes — its documents return
  to the root — and needs no undo.
- **No `/api/v1` trash listing** and no CLI `restore` command yet. The v1
  surface can trash, restore and destroy a document by id; listing the trash
  stays a web route for now.
- **No Yorkie-side cleanup.** A permanent delete removes the Postgres row and
  the blob, as the old delete did; the Yorkie document is left behind exactly
  as before.

## Proposal Details

### Data model

```prisma
model Document {
  // …
  deletedAt DateTime?   // null = live; set = in the trash since then

  @@index([workspaceId, folderId])
  @@index([workspaceId, deletedAt])
}
```

Migration `20261114064942_document_trash` adds the column (every existing row
is live) and the index the trash list and the live-only workspace lists read.

Trashing does **not** touch `updatedAt`: it is not an edit, and a restored
document should sort where it did before. Trashing an already-trashed document
is a `404` rather than a reset of `deletedAt`, so the trash keeps its order.

### API

| Method | Route | Gate | Behavior |
|--------|-------|------|----------|
| `DELETE` | `/documents/:id` | manager | Trash a live document; returns the row with `deletedAt` set |
| `DELETE` | `/documents/:id?permanent=true` | manager | Delete a **trashed** document for good, plus best-effort blob cleanup. `404` for a live one |
| `POST` | `/documents/delete` `{ ids, permanent? }` | manager of every id | Bulk trash (live ids only), or bulk permanent delete (trashed ids only); `{ deleted: ids }` |
| `POST` | `/documents/:id/restore` | manager | Clear `deletedAt`; returns the document. `404` if missing or live |
| `GET` | `/workspaces/:workspaceId/trash` | member | Trashed documents, `deletedAt` desc, in the workspace-list row shape plus `deletedAt` (ISO) |
| `DELETE` | `/api/v1/workspaces/:wid/documents/:did[?permanent=true]` | manager | Same as the web delete |
| `POST` | `/api/v1/workspaces/:wid/documents/:did/restore` | manager | Same as the web restore |

Only the literal `permanent=true` destroys. Any other value — `1`, `yes`, a
typo — falls back to the trash, the recoverable direction.

The trash list is gated on **membership**, like the workspace list: a member
could see these documents before they were trashed, and every row carries
`canManage` so the client knows which ones the caller may restore or destroy.
Restore and permanent delete use the manager gate (workspace owner or the
document's author), the same tier that may trash it in the first place.

A bulk request is atomic in its gate, as before: one missing or unmanageable id
refuses the whole request before any write. For a bulk *trash* an id already in
the trash counts as missing; for a bulk *permanent* delete a **live** id counts
as missing.

### Permanent delete reaches only the trash

A permanent delete — single, bulk, or v1 — destroys only a document that is
already in the trash. Nothing needs to destroy a live document in one step (the
Trash page is the only caller, and it only lists trashed ones), and allowing it
made "Empty trash" a data-loss race: the page sends ids from the list it
loaded, so a document a collaborator restored after that would be destroyed,
blob and all, while live.

The check is made twice. The read (`trashedDocument()`) gates the request, so a
live id is a `404` (single) or refuses the whole bulk request (`403`, like any
other id the caller may not delete). The write (`purgeTrashedDocument()`) is a
`deleteMany` where `deletedAt IS NOT NULL` — a compare-and-set — so a restore
that lands between the read and the write still wins: the single route answers
`404`, a bulk request leaves that id out of `deleted`, and in both cases its
blob is not touched, because blob cleanup runs only for the rows actually
deleted. A bulk purge is a compare-and-set per id rather than one transaction;
that is what lets it report exactly which ids it destroyed.

`DocumentService.deleteDocument()` remains unconditional, for one caller: the
copy service's rollback of a half-made copy it has just created.

### The visibility invariant

`src/document/live-document.ts` owns it:

- `LIVE_DOCUMENT` (`{ deletedAt: null }`) is merged into a Prisma `where` when
  the query itself selects documents — a `findMany`, or a `findUnique` with an
  extended unique filter.
- `isLiveDocument(row)` / `assertLiveDocument(row)` check a document that
  arrived through a relation (`include: { document: true }`), where filtering
  the relation would change what the parent lookup returns.

`DocumentService` applies it to every read it offers. `document()`,
`getDocumentOrThrow()`, `documents()` and `listDocumentsWithAuthor()` are
live-only; the two methods that see the trash say so by name —
`documentIncludingTrashed()` (restore), `trashedDocument()` (permanent delete)
and `listTrash()`.
Making the default live-only, rather than adding a filter to each caller, is
what keeps a new route safe by default: a handler written next year that reads
a document through `DocumentService` gets the invariant without knowing it
exists.

Every path that reads a document, and how it is gated:

| Path | Gate |
|------|------|
| Workspace list, folder list, `GET /documents` | `listDocumentsWithAuthor` (live-only) |
| `GET /documents/:id`, `PATCH`, copy, move, single/bulk trash | `DocumentService.document` (live-only) → `404` |
| `GET /documents/:id/file` | `DocumentService.document` → `404` |
| Share-link resolution (`/share-links/:token/resolve`, `POST /share-links/resolve`) | `ShareLinkService.findByToken` → `404` |
| Share-link mint / list (`resolveCapability`) | `LIVE_DOCUMENT` in its `findUnique` → `404` |
| Share-token file and image serving, shared image upload | `findByToken` → `404` |
| Yorkie auth webhook, member identity | `DocumentService.document` → deny |
| Yorkie auth webhook, share-link identity | `findByToken` throws → deny |
| Analytics beacon | `findByToken` → `404` |
| Analytics document dashboard / workspace ranking | `LIVE_DOCUMENT` → `404` / excluded |
| Comment notification report | `LIVE_DOCUMENT` → `404` |
| Template publish / update / submit / unpublish | `assertManager` with `LIVE_DOCUMENT` → `404` |
| Template preview (`findForViewer`), use, report | `isLiveDocument(listing.document)` → `404` |
| Template gallery (`browse`), reviewer queue, report queue | `document: LIVE_DOCUMENT` in the query |
| Template review | `isLiveDocument(listing.document)` → `404` |
| Share dialog template lookup (`findByDocument`) | `isLiveDocument` → `null` |
| `DocumentCopyService.copy` | `assertLiveDocument(source)` — defense in depth |
| `/api/v1` documents list / get / copy / patch | `DocumentService` (live-only) |
| `/api/v1` content, tabs, cells, worksheet, slides, comments, files | `getDocumentOrThrow` / `assertSheetDocument` (live-only) → `404` |
| Template seed (`seed:templates`) | refuses a seeded id that is in the trash |

Two choke points do most of the work. `getDocumentOrThrow` backs every
`/api/v1` content route, and `ShareLinkService.findByToken` is the one function
every share-token path goes through — the share page, file and image serving,
the Yorkie webhook and the analytics beacon. Closing the trash there closes all
of them.

**The webhook matters most.** A share-link viewer holds what it takes to skip
the app: their token mints a Yorkie token and the project's public key ships in
the bundle, so a bare SDK client attaches directly
([yorkie-auth-webhook.md](yorkie-auth-webhook.md)). The webhook is therefore
the only place a trashed document's content is actually refused. Both of its
identities resolve the document through a live-only path, so a member and a
share-link holder are each denied read and write the moment the document is
trashed — `yorkie-auth.controller.spec.ts` asserts this against the real
`DocumentService` and `ShareLinkService` rather than stubs.

A trashed document answers `404`, never `403` or `410`. Whether a document is
in the trash is itself information a share-link holder should not learn.

### What survives the trash

Nothing related to a document is deleted when it is trashed, only hidden:

- **Share links** keep their rows. They resolve to `404` while the document is
  trashed and work again after a restore, with the same tokens and expiry.
- **Template listings** keep their rows and their review state. The listing
  leaves every gallery and queue and its preview 404s, for its manager too —
  the listing is a window onto the document. Restoring the document brings it
  back as it was; a permanent delete cascades it away (`onDelete: Cascade`).
- **Notifications** already delivered stay in the recipient's inbox. They are
  history, the recipient was a member when they were sent, and following one
  lands on the document's not-found state rather than a crash. New comment
  reports on a trashed document are refused.
- **Blobs** stay in storage until the permanent delete.

### Restore and folders

Deleting a folder already `SetNull`s `folderId` on every document in it —
trashed ones included — so a document whose folder was deleted while it sat in
the trash simply comes back at the workspace root. Restore needs no folder
logic of its own. A document in a still-existing folder returns to it.

Restore is a compare-and-set (`updateMany` where `deletedAt IS NOT NULL`), so a
second concurrent restore, or a restore racing a permanent delete, gets a `404`
instead of a phantom success. The permanent delete is the same kind of
compare-and-set from the other side (see above), so whichever of the two lands
first wins and the other is a `404`.

## Risks and Mitigation

- **A new read path that bypasses the helpers.** A handler that queries
  `prisma.document` directly with no `LIVE_DOCUMENT` would read trashed rows.
  Mitigation: `DocumentService` is live-only by default, the invariant is
  documented at the top of `live-document.ts`, and grepping for
  `prisma.document` / `include: { document` against this doc's table is the
  audit. A Prisma client extension that rewrites every query was considered and
  rejected: it would also hide trashed rows from the trash routes and from
  cascades, and an implicit filter is harder to audit than an explicit one.
- **Trashed documents never leave.** With no purge, the trash grows without
  bound and its blobs keep their storage. Accepted for this PR and stated as a
  Non-Goal; the UI must not promise automatic deletion. The
  `[workspaceId, deletedAt]` index keeps the trash list cheap regardless.
- **Clients that assumed delete was permanent.** The CLI and other v1 callers
  that delete a document now trash it, and its blob stays. The response shape
  is unchanged and the document disappears from every read exactly as before,
  so a caller that only checks the status sees no difference; one that needs
  the bytes gone follows with `DELETE …?permanent=true`, which only reaches a
  document already in the trash.
- **A trashed document's Yorkie session already open.** A client attached
  before the trash keeps its local copy; the webhook refuses its next
  `PushPull`, so it can neither read new changes nor write. That is the same
  behavior a revoked share link already has.
- **A leaked share link cannot be revoked from the trash.** Share-link
  routes resolve the document first and answer `404` for a trashed one, so
  while it sits in the trash its links can be neither listed nor revoked, and
  restoring it revives them as they were. The links do not work while it is
  trashed, which is the property that matters; to kill one for good, delete
  the document forever, or restore it and revoke the link.
