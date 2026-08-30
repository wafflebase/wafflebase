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
- `GET /share-links/:token/resolve` — Resolve token (public, no auth)

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

### Security

- **Token entropy** — UUIDs provide 122 bits of entropy, making tokens
  unguessable.
- **Revocation** — Deleting a ShareLink immediately invalidates the token.
- **Cascade deletion** — Deleting a document cascades to all its share links.
- **Server-side write enforcement** — The Yorkie auth webhook enforces the
  share-link role server-side: an anonymous visitor's token is checked in
  `hasAccess()` (`packages/backend/src/document/yorkie-auth.controller.ts`),
  which returns `needWrite ? link.role === 'editor' : true`, so a `viewer` token
  requesting a write (`rw`) verb is denied with `403`
  (see [yorkie-auth-webhook.md](yorkie-auth-webhook.md)). Client-side read-only
  mode additionally gates the UI so a viewer never hits the error path, and the
  Yorkie doc key is only revealed after valid token resolution.
- **Expiration** — Links can have time-limited access (1h, 8h, 24h, 7d).

### Risks and Mitigation

**Token leakage** — If a share link URL is leaked, anyone with it can access
the document. Mitigation: link expiration, ability to revoke links, and
client-side role enforcement.

**Token leakage across write access** — A `viewer` link is read-only, but an
`editor` link grants anonymous write access. Mitigation: editor links are gated
to workspace owners / document authors, are revocable and expirable, and the
Yorkie auth webhook enforces the link role server-side, so bypassing the
client-side read-only checks does not grant a viewer token write access.

**Brute-forcing token resolution** — The public resolve endpoint could be
probed. Mitigation: UUID tokens have sufficient entropy to make brute-force
impractical, and the endpoint is rate limited by the global
`@nestjs/throttler` `ThrottlerGuard` (default 120 req/min per client,
`packages/backend/src/app.module.ts`).
