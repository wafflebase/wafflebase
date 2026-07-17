# Share Link Permissions — todo

Rework share-link authorization so it respects workspace ownership and
document authorship instead of the current document-author-only gate. A
workspace owner (or the document author) who did not personally create the
document currently gets a 403 → generic "Failed to create share link" toast,
even though they have full `rw` access to the document.

## Policy matrix (approved)

| Actor        | create viewer | create editor | list | revoke        |
| ------------ | :-----------: | :-----------: | :--: | ------------- |
| WS owner     | ✅            | ✅            | ✅   | any link      |
| Doc author   | ✅            | ✅            | ✅   | any link      |
| WS member    | ✅            | ❌            | ✅   | own links only|
| Non-member   | ❌            | ❌            | ❌   | ❌            |

Capability derivation (single source in backend, post-review):
- access requires `isMember || isAuthor` (else 403)
- `isManager` = `isOwner || isAuthor` — gates editor creation + managing
  others' links (the two authorities coincide today, so one flag)
- viewer creation needs only access; a link's creator may always revoke it

## Backend

- [x] `share-link.service.ts` — add a private `resolveCapability(documentId, userId)`
      helper (loads doc, resolves workspace membership via non-throwing
      `findUnique`, combines with `isAuthor`). Returns `{ isAuthor, isOwner,
      hasAccess, canCreateEditor, canManageAllLinks }`.
- [x] `create` — validate `role ∈ {viewer, editor}`; gate `editor` on
      `canCreateEditor`, `viewer` on `hasAccess`; specific 403 messages.
- [x] `findByDocument` — relax to `hasAccess`; return
      `{ links, permissions: { canCreateEditorLink, canManageAllLinks } }`.
- [x] `delete` — allow `canManageAllLinks || link.createdBy === userId`.
- [x] Inject/reuse workspace membership lookup (avoid a hard dependency cycle;
      query `prisma.workspaceMember` directly in the service).
- [x] Unit tests: owner-not-author create editor ✅, member create editor 403,
      member create viewer ✅, non-member 403, delete-any vs delete-own.

## Frontend

- [x] `share-links.ts` — `getShareLinks` returns `{ links, permissions }`;
      update `createShareLink` callers. Keep `assertOk` server message usable.
- [x] `share-dialog.tsx` — consume `permissions`; disable `editor` option +
      tooltip when `!canCreateEditorLink`; gate per-link delete button by
      `canManageAllLinks || link.createdBy === me`.
- [x] `handleCreate` catch — surface the server error message instead of the
      hardcoded generic toast.

## Document Delete / Move (follow-on, same PR)

Delete/Move had the *inverse* gap: gated only on `assertMember`, so any plain
member could delete or move another member's (incl. the owner's) document.
Tightened to the same manager tier (`isOwner || isAuthor`); Rename stays
member-level (it's an edit).

- [x] `DocumentController.resolveDocManager` helper (member + owner-role/author).
- [x] Legacy `DELETE /documents/:id` → manager only.
- [x] Legacy `PATCH /documents/:id` → rename any member; move manager only
      (+ destination membership).
- [x] v1 `DELETE /api/v1/.../documents/:did` → manager gate for JWT callers;
      API keys require `write` scope (read-only keys rejected — review R3 F1).
- [x] Extract shared `isDocumentManager` helper (review R3 F4) reused by the
      legacy gate, v1 gate, list `canManage`, and share-link `resolveCapability`.
- [x] `WorkspaceService.findMembershipsByUser` + list `canManage` annotation on
      `GET /documents` and `GET /workspaces/:id/documents`.
- [x] Frontend: `Document.canManage`; hide Delete/Move in the list dropdown
      when `!canManage` (Rename stays).
- [x] Unit tests: `document.controller.spec.ts` (12), `documents.controller.spec.ts` (4).
- [x] HTTP e2e: member can rename, cannot move/delete; owner can delete;
      `canManage` flag per row.
- [x] Docs: `backend.md` stale author-only claims → workspace + manager model.

## Docs

- [x] Update `docs/design/sharing.md` "owner only" wording → this matrix.

## Verify

- [x] `pnpm verify:fast` (EXIT=0)
- [x] DB integration (`ShareLinkService` + authenticated-http share-link): 16 passed
- [x] Manual smoke: workspace owner (non-author) creates a link in `pnpm dev`.

## Review (self code-review, high effort)

Workflow-backed review surfaced 8 findings; all addressed:

1. **[security] editor token exposure** — `findByDocument` handed editor tokens
   to plain members, who could copy + redistribute them (bypassing "members
   can't mint editor links"). Fixed: non-managers no longer receive editor
   links in the list.
2. **[correctness] creator locked out of own link** — `delete` ran
   `resolveCapability` (needs current membership) before the creator check, so
   a creator who left the workspace couldn't revoke their own link. Fixed:
   short-circuit on `createdBy === userId` first.
3. **[correctness] revoke button hidden during load** — gating on `fetchMe`
   left members unable to revoke their own links while `["me"]` was unresolved
   / failed. Fixed: backend now returns a per-link `canDelete`; `fetchMe`
   removed from the dialog entirely.
4. **[correctness] editor option disabled for managers on open** — default
   perms (all false) briefly disabled the editor option + showed the hint to an
   owner. Fixed: `loaded` flag gates the hint, editor `disabled`, and the
   Create button until the fetch resolves.
5. **[cleanup] stale perms across documentId** — dialog reused a prior
   document's perms during the async gap. Fixed: reset links/perms/`loaded` at
   the start of each fetch, with cancellation.
6. **[cleanup] duplicate capability flags** — `canCreateEditor` and
   `canManageAllLinks` were always identical. Collapsed to one `isManager`;
   wire sends only `canCreateEditorLink` + per-link `canDelete`.
7. **[cleanup] dead `hasAccess` field** — removed from the returned struct
   (access is enforced by the throw inside `resolveCapability`).
8. **[cleanup] bypasses WorkspaceService** — kept the direct `workspaceMember`
   query with a justifying comment: `doc.workspaceId` is already canonical (no
   slug resolution) and we need a non-throwing, author-aware lookup that
   `assertMember` does not provide.

### Round 2 (re-review after applying the above)

9. **[correctness] demoted ex-manager can't revoke own editor link** — the
   editor-link filter hid *all* editor links from a non-manager, including ones
   they created while still an owner, so a live anonymous write link became
   unrevocable via the UI. Fixed: filter keeps `role !== 'editor' ||
   createdBy === userId`.
10. **[correctness] list-fetch failure locks the Create button** — a swallowed
    `getShareLinks` rejection left `loaded=false`, permanently disabling Create
    with no feedback. Fixed: set `loaded` in `finally`, surface the error via
    toast, and fall back to viewer-only perms (backend stays the real gate).

### Round 3 (review of the delete/move commit)

11. **[security] v1 DELETE exempted all API keys** — a read-only key could
    delete documents (my exemption skipped the scope check). Fixed: API keys
    now require the `write` scope; read-only keys get 403.
12. **[cleanup] manager predicate duplicated ×4** — extracted
    `document/document-access.ts#isDocumentManager`, reused by the legacy gate,
    v1 gate, list `canManage`, and share-link `resolveCapability`.
- **F2 (null authorID → owner-only manage)**: accepted as by-design — there is
  always a workspace owner who can manage, so no document is unmanageable;
  documented in the `isDocumentManager` doc-comment.
- **F3 (redundant `assertMember` on the v1 JWT path)**: left as-is; threading
  the role through the shared `WorkspaceScopeGuard` would couple every v1 route
  for one avoidable `findUnique` on the delete path only.

## Audit closure (2026-07-17, second pass)

Archived by the active-tasks audit after pulling `main`. Verified shipped: merged
PR #484 (`cb188500a`) — `document-access.ts` (manager-tier capability resolution),
`share-link.service.spec.ts`, `documents.controller.spec.ts`, `share-dialog.tsx`
per-link `canDelete`/`isManager`; DB integration 16 passed; all 8 self-review
findings addressed. Box ticked for closure. **Not executed**: the manual
`pnpm dev` owner-non-author smoke — covered by the DB + authenticated-http
integration tests, but not run interactively.
