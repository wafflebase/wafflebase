# Workspace settings — gate owner-only controls (issue #733)

## Problem

`/w/:workspaceId/settings` renders three owner-only controls to every
member: the remove-member trash icon, "Create Invite", and the
revoke-invite trash icon. All three call backend endpoints guarded by
`assertOwner`, so a non-owner clicking them just gets an error toast.
`isOwner` already exists in `workspace-settings.tsx` and correctly gates
the API Keys and Danger Zone sections.

## Scope

Frontend only — `packages/frontend/src/app/workspaces/workspace-settings.tsx`.
No backend change: the server-side authorization is already correct.

## Plan

- [x] Gate the whole Invites section behind `isOwner` (the invite *list*
      endpoint `GET /workspaces/:id/invites` is `assertOwner` too, so a
      non-owner's query 403s and the section can only ever read "No active
      invites"). Also set `enabled: !!isOwner` on the invites query, matching
      the existing api-keys query.
- [x] Gate the remove-member trash icon: render it when the viewer is an
      owner, or when the row is the viewer's own membership. `removeMember`
      permits self-removal (`requesterId === targetUserId` skips
      `assertOwner`), so a member removing themselves is a working action and
      must not be hidden.
- [x] Verify no other owner-only control on the page is ungated.

## Acceptance criteria (from the issue)

- Non-owner members do not see the remove-member trash icon (for other
  members), "Create Invite", or the revoke-invite trash icon.
- Owners see all three unchanged.
