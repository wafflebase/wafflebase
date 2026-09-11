---
title: sharing
target-version: 0.1.0
---

# URL-Based Token Sharing

## Summary

Documents in Wafflebase are shareable via URL-embedded tokens, similar to Google
Docs' "Anyone with the link" feature. Workspace members can generate share links
with a specific role (`viewer` or `editor`) and optional expiration, subject to
the permission matrix below. Anyone with a valid link can access the document
without logging in.

### Goals

- Allow document owners to share documents via URL with configurable permissions.
- Support anonymous access — no login required for shared link users.
- Support view-only and edit access levels.
- Allow link expiration and revocation.

### Non-Goals

- User-level invites or per-user permission management.
- Granular permissions (e.g., comment-only, specific cell ranges).

## Proposal Details

### Architecture

```
Owner creates share link → Backend generates UUID token → Owner copies URL
                                                              ↓
Anonymous user opens /shared/:token → Frontend resolves token via API
                                                              ↓
                                   Backend validates token + expiration
                                                              ↓
                                   Frontend connects to Yorkie doc with role
```

### Backend

**ShareLink model** — Stored in PostgreSQL via Prisma. Each link has a unique
UUID token, a role (`viewer`/`editor`), an optional expiration, and references
to the document and creator.

**API endpoints:**
- `POST /documents/:id/share-links` — Create link (JWT required; see matrix)
- `GET /documents/:id/share-links` — List links + caller capabilities (JWT
  required, any workspace member)
- `DELETE /share-links/:id` — Revoke link (JWT required; see matrix)
- `POST /share-links/resolve` — Resolve token (public, no auth), token in the
  **body**. This is what the client calls: the shared view re-resolves its
  token every minute and on tab focus, and a path segment would write that
  access-granting token into every access log, proxy and CDN between the
  visitor and the backend on each of those requests. Same reasoning as
  `POST /auth/yorkie-token/share`.
- `GET /share-links/:token/resolve` — The same answer with the token in the
  path (public, no auth). Kept for one-shot callers that predate the POST form
  — an older frontend served during a rollout — and redacted in this server's
  own logs by `SECRET_PATH_SEGMENTS` in `log-safe-url.ts`, which can do
  nothing about anyone else's.

The list endpoint returns `{ links, permissions: { canCreateEditorLink } }`,
where each link is annotated with a server-computed `canDelete` flag, so the
client gates the UI without re-deriving roles or knowing its own user id. It
also **omits editor links a non-manager did not create**: a plain member may
not mint an editor link, so handing them someone else's editor token (which
they could copy and redistribute) would escalate anonymous write access they
were never allowed to grant. Their own editor links stay visible so a demoted
ex-manager can still find and revoke live links they minted. The resolve
endpoint returns `{ documentId, role, title, type }` on
success, `410 Gone` for expired tokens, and `404` for invalid tokens.

### Permission model

Share-link authority follows the workspace access model rather than document
authorship alone. Every workspace member has `rw` on the document
(see [yorkie-auth-webhook.md](yorkie-auth-webhook.md)), so any member may hand
out a read (`viewer`) link; issuing a write (`editor`) link — a broader
escalation to anonymous users — is reserved for the workspace **owner** or the
document **author** (`isManager`). `ShareLinkService.resolveCapability` computes
this once from the document (`authorID`, `workspaceId`) and the caller's
`WorkspaceMember.role`, and create / list / delete all consume it:

| Actor        | create viewer | create editor | list | revoke         |
| ------------ | :-----------: | :-----------: | :--: | -------------- |
| WS owner     | ✅            | ✅            | ✅   | any link       |
| Doc author   | ✅            | ✅            | ✅   | any link       |
| WS member    | ✅            | ❌            | ✅   | own links only |
| Non-member   | ❌            | ❌            | ❌   | ❌             |

Access requires `isMember || isAuthor` (else `403`); `isManager = isOwner ||
isAuthor` gates editor-link creation and managing others' links. A link's
**creator can always revoke it**, even after leaving the workspace, so `delete`
short-circuits on `createdBy === userId` before the manager check. Rejections
raise a specific `403` (e.g. "Only the workspace owner or document owner can
create editor links") which the frontend surfaces verbatim; the UI additionally
disables the editor option and hides revoke buttons the caller cannot use, so a
permitted user never hits the error path.

### Image bytes under a share link

CRDT edits are authorized by the Yorkie auth webhook
([yorkie-auth-webhook.md](yorkie-auth-webhook.md)), which resolves the link and
answers `editor → write`. Image **bytes** travel over plain HTTP instead, so
they need their own decision at both ends:

- **Read** — `GET /api/v1/workspaces/:wid/images/:id` accepts `?token=`
  (`ApiV1ImageReadController`). Role is deliberately ignored: a viewer link is
  meant to read.
- **Write** — `POST /api/v1/shared/images?token=`
  (`ApiV1ShareImageUploadController`). Role is **not** ignored here: it requires
  `link.role === 'editor'`, mirroring the webhook's own write decision. The
  route takes no `:workspaceId`; the storage prefix is read off
  `link.document.workspaceId`, because a client-supplied id would let a token
  proving access to one workspace write into another's key space — and
  `WorkspaceScopeGuard` cannot catch that, since it authorizes by calling
  `assertMember(user.id)` and an anonymous caller has no user.

The URL the upload returns carries **no** token: it is stored in the CRDT and
read by every other visitor plus the author, so each engine appends the current
visitor's token at render time through its `setImageUrlResolver` seam
(`IMAGE_RESOLVER_INSTALLERS` in `shared-document.tsx`; the origin gate in
`appendShareTokenToImageUrl` is what stops a hostile collaborator pointing a
`src` at their own host to harvest the token).

Two client-side rules follow from the same place:

- **An anonymous surface must not call `fetchWithAuth`.** It reads a 401/403 as
  an expired session and recovers by logging out and navigating to `/login` —
  which, for a visitor whose only credential is the link, destroys the access
  they had. This is what made a failed docs image upload eject the visitor from
  the document (issue #1037).
- Docs is still the one type whose *owner* route uploads through the
  unauthenticated root-bucket `POST /images`, so a single document can hold
  URLs from both spines. The resolver matches only the workspace path, so a
  legacy `/images/:id` URL is left untouched.

Slides, board and sheets share-link mounts still pass no uploader, so image
insert stays unavailable there.

### Frontend

**Share dialog** (`ShareDialog` component) — Opened from the document header
"Share" button. Allows creating links with role and expiration settings, copying
URLs to clipboard, and revoking existing links.

**Shared document route** (`/shared/:token`) — Placed outside `PrivateRoute` so
anonymous users can access it. Resolves the token, sets up `YorkieProvider` and
`DocumentProvider`, and branches on the resolved `type` to a per-type read-only
layout: sheet, docs, slides (`SharedSlidesLayout`, with desktop/mobile
variants), notes (`SharedNotesLayout`), board (`SharedBoardLayout`), and PDF
(`SharedPdfLayout`). The sheet view follows the document's `tabOrder` and
exposes tab switching across all tabs (sheet and datasource). Attempts to detect
logged-in users for presence identity; falls back to "Anonymous". For `viewer`
links, editing remains blocked across tab types (including datasource query
editing).

### Sheet Package (Read-Only Mode)

The `Spreadsheet` class accepts a `readOnly` option. When enabled:
- Cell editing (keyboard input, double-click) is blocked
- Formula bar editing/commit is blocked
- Delete, paste, undo/redo operations are blocked
- Formatting changes (bold, italic, style application) are blocked
- Context menu (insert/delete rows/columns) is blocked
- Resize and drag-move operations are blocked
- Navigation, selection, scrolling, and copy still work
- The formatting toolbar is hidden in the React component

### Docs Package (Read-Only Mode)

The Docs editor accepts a `readOnly` flag threaded through
`initialize(container, store, theme, readOnly)`. Rather than skipping the
`TextEditor` (which owns all pointer, clipboard, and link machinery), it is
constructed in read-only mode too, with every **mutating** path gated so
"read the document" interactions match Google-Docs viewer parity. When enabled:
- Typing, IME composition, cut, and paste are blocked
- Keyboard is limited to caret navigation (Arrows / Home / End),
  `Cmd/Ctrl+A` select-all, and `Cmd/Ctrl+F` find; other edit shortcuts no-op
- Table-border resize and header/footer edit-context switching are blocked
- The programmatic `EditorAPI` mutating commands (`applyStyle`, `insertLink`,
  `paste`, table / image ops, …) are neutralized at the API boundary, and the
  direct `TextEditor` entry points (`pasteContent`, `insertText`) are gated —
  so read-only holds even for callers that bypass pointer / keyboard events
- The link popover shows only the open-link anchor (Edit / Remove hidden)
- Drag selection, `Cmd/Ctrl+C` copy, and plain-click link open still work
- Clicking an image selects it, so a viewer can copy it. The overlay is
  border-only — no resize handles are painted and no resize cursor appears
  over where they would be — because a resize is a document write. The
  resize drag itself is refused at three points (arming, move, and the
  CRDT commit), which matters because the client `readOnly` flag is the
  effective write boundary for an anonymous share link whenever the Yorkie
  auth webhook is left in shadow mode
- The hidden textarea is not auto-focused on mount; focus is acquired on
  the first click **or on an image click**, so the caret paints and the
  browser copy event fires. Selecting an image focuses it too — otherwise
  the click that selects an image would leave nothing able to receive the
  `copy` event, and `Cmd/Ctrl+C` over it would do nothing. Focus mutates
  no document state; every write stays behind a `readOnly` gate

### A link is a live capability, not a load-time fact

A share link's role can change while a tab sits open — the link is revoked,
it expires, or the document's manager re-mints it as `viewer` after handing
it out as `editor`. Resolved once at page load, the view could only ever
*loosen*: it kept the authority it opened with for the tab's lifetime.

So `SharedDocumentByToken` (`app/shared/shared-document.tsx`) re-resolves its
token on an interval — `SHARE_LINK_REVALIDATE_MS`, 60 s — and on tab focus,
through react-query. That is one unauthenticated lookup per minute per open
tab, which is why `resolveShareLink` posts the token rather than putting it in
the path: repeating a credential in a URL repeats it into every access log on
the way. react-query pauses the interval while the tab is hidden, and its
structural sharing keeps `resolved`'s identity stable, so an unchanged link
re-renders nothing. The interval is what bounds how long a revoked or
downgraded link keeps presenting authority it no longer has.

Two consequences the rest of the frontend has to honour:

- **A verdict evicts the session; a failed request must not.** react-query
  keeps its last good `data` while reporting `error` for every failed
  *background* refetch, so treating any error as a revocation tore down a
  live editing session — losing whatever had not synced — on the first laptop
  sleep or backend restart that outlasted the retry.
  `isRevokedShareLinkError` (`api/share-links.ts`) therefore enumerates the
  two statuses `POST /share-links/resolve` actually answers with:
  `404` (revoked, or never existed) and `410` (expired). Everything else — a
  5xx, a timeout, a rate-limit, the `TypeError` a failed connection throws,
  and any 4xx produced by a proxy in front of the handler — keeps the last
  good resolution and keeps retrying.
- **`readOnly` is a remount dependency, not a prop read once.** Every editor
  captures it at `initialize()` and nothing re-arms it on a mounted
  instance, so the docs / notes / slides views list it in their mount-effect
  deps: a downgrade rebuilds the editor against the current permission,
  because that is the only place the permission is applied. A rebuild
  discards the editor's store while the Yorkie document — owned by the
  enclosing `DocumentProvider` — stays attached, so each store needs a
  disposal seam (`YorkieDocStore.dispose()`, `YorkieNoteStore.dispose()`,
  `YorkieSlidesStore.dispose()`); a store left subscribed keeps driving an
  editor that no longer exists.

Rebuilding is not the same as revoking what the old editor already handed
out. The docs `EditorAPI` gives callers long-lived objects — `getStore()` and
`getDoc()`, which `docs-find-bar` takes once for the editor's lifetime — so
changing what the accessors return revokes nothing for a holder that has the
object already. `dispose()` therefore neuters them: the store handle is a
revocable proxy whose mutators become no-ops (`revocableDocStore` in
`packages/docs/src/store/read-only.ts`), alongside `EditorAPI`'s own mutating
members and `EditorAPI.isDisposed()`, so a stale handle cannot write through
the rebuild.

All of this is client-side, and deliberately so: it stops the *client*
presenting authority it no longer has. What stops a write is the Yorkie auth
webhook — see **Server-side write enforcement, once enabled** below, and note
that it is off in a stock deployment.

### Security

- **Token entropy** — UUIDs provide 122 bits of entropy, making tokens
  unguessable.
- **Revocation** — Deleting a ShareLink immediately invalidates the token for
  any new resolution, and a mounted view gives up its authority within
  `SHARE_LINK_REVALIDATE_MS` (above). It does not by itself reach a session
  already attached to the Yorkie document; that is the auth webhook's job.
- **Cascade deletion** — Deleting a document cascades to all its share links.
- **Server-side write enforcement, once enabled** — The Yorkie auth webhook can
  enforce the share-link role server-side: an anonymous visitor's token is
  checked in `hasAccess()`
  (`packages/backend/src/document/yorkie-auth.controller.ts`), which returns
  `needWrite ? link.role === 'editor' : true`, so a `viewer` token requesting a
  write (`rw`) verb is denied with `403`
  (see [yorkie-auth-webhook.md](yorkie-auth-webhook.md)).

  This is **off by default**. `YORKIE_AUTH_WEBHOOK_ENFORCE` is unset in a
  stock deployment, which puts the controller in shadow mode: it logs the
  decision it would have made and answers `allowed: true` anyway. So the
  sentence above describes the enforced configuration, and in the default one
  the client-side `readOnly` flag is the write boundary rather than a
  convenience in front of one. That is why the client-side gates are treated
  as load-bearing throughout this document, and why `EditorAPI`'s store and
  doc accessors hand out a neutered `DocStore` under `readOnly`
  (`packages/docs/src/store/read-only.ts`, issue #989) rather than relying on
  the server to catch what gets through. Client-side read-only also gates the
  UI so a viewer never hits the error path, and the Yorkie doc key is only
  revealed after valid token resolution.
- **Expiration** — Links can have time-limited access (1h, 8h, 24h, 7d).

### Risks and Mitigation

**Token leakage** — If a share link URL is leaked, anyone with it can access
the document. Mitigation: link expiration, ability to revoke links, and
client-side role enforcement.

**Token leakage across write access** — A `viewer` link is read-only, but an
`editor` link grants anonymous write access. Mitigation: editor links are gated
to workspace owners / document authors, and are revocable and expirable. With
`YORKIE_AUTH_WEBHOOK_ENFORCE=true` the auth webhook enforces the link role
server-side, so bypassing the client-side read-only checks does not grant a
viewer token write access; with the flag at its default the client-side checks
are what stands there, so they are written to fail closed (see **Server-side
write enforcement, once enabled** above).

**Brute-forcing token resolution** — The public resolve endpoint could be
probed. Mitigation: UUID tokens have sufficient entropy to make brute-force
impractical, and the endpoint is rate limited by the global
`@nestjs/throttler` `ThrottlerGuard` (default 120 req/min per client,
`packages/backend/src/app.module.ts`).
