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
- Server-side write protection — view-only enforcement is client-side only.
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
`DocumentProvider`, and renders the spreadsheet. The shared view follows the
document's `tabOrder` and exposes tab switching across all tabs (sheet and
datasource). Attempts to detect logged-in users for presence identity; falls
back to "Anonymous". For `viewer` links, editing remains blocked across tab
types (including datasource query editing).

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

### Security

- **Token entropy** — UUIDs provide 122 bits of entropy, making tokens
  unguessable.
- **Revocation** — Deleting a ShareLink immediately invalidates the token.
- **Cascade deletion** — Deleting a document cascades to all its share links.
- **Client-side enforcement** — View-only mode is enforced in the browser.
  Yorkie does not support per-user write auth, but the Yorkie doc key is only
  revealed after valid token resolution, limiting exposure.
- **Expiration** — Links can have time-limited access (1h, 8h, 24h, 7d).

### Risks and Mitigation

**Token leakage** — If a share link URL is leaked, anyone with it can access
the document. Mitigation: link expiration, ability to revoke links, and
client-side role enforcement.

**No server-side write protection** — A technically sophisticated user could
bypass client-side read-only checks and write to the Yorkie document directly.
Mitigation: acceptable for v1 since the Yorkie doc key is only revealed after
valid token resolution; server-side enforcement can be added later via Yorkie
webhooks.

**No rate limiting on token resolution** — The public resolve endpoint could be
brute-forced. Mitigation: UUID tokens have sufficient entropy to make brute-force
impractical; rate limiting via `@nestjs/throttler` can be added as needed.
