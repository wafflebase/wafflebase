---
title: sharing
target-version: 0.1.0
---

# URL-Based Token Sharing

## Summary

Documents in Wafflebase are shareable via URL-embedded tokens, similar to Google
Docs' "Anyone with the link" feature. Document owners can generate share links
with a specific role (`viewer` or `editor`) and optional expiration. Anyone with
a valid link can access the document without logging in.

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
- `POST /documents/:id/share-links` — Create link (JWT required, owner only)
- `GET /documents/:id/share-links` — List links (JWT required, owner only)
- `DELETE /share-links/:id` — Revoke link (JWT required, creator only)
- `GET /share-links/:token/resolve` — Resolve token (public, no auth)

The resolve endpoint returns `{ documentId, role, title }` on success,
`410 Gone` for expired tokens, and `404` for invalid tokens.

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
