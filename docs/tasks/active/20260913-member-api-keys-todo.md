# Let workspace members mint their own API keys

## Problem

`POST` and `DELETE /workspaces/:wid/api-keys` are gated on `assertOwner`, and
the frontend hides the whole API Keys section behind `isOwner`. A member can
therefore neither mint a key nor see that any exist — which shuts them out of
the CLI and `/api/v1` entirely, even though the web UI already grants them the
authority those surfaces expose.

The gate has no security work to do. `api-key.strategy.ts` mints the request
identity as `id: apiKey.createdBy`, so a key carries its **creator's** authority,
not the workspace's; `WorkspaceScopeGuard` re-checks that membership on every
request; and `/api/v1` carries no workspace-administration routes. A
member-minted key is the member's own hands, reached over HTTP.

## Decision

Open minting to members, and scope visibility and revocation by creator:

| Route | Before | After |
| --- | --- | --- |
| `POST` | owner | any member |
| `GET` | member, returns every key | member: own keys; owner: all |
| `DELETE` | owner | member: own keys; owner: all |

A member revoking somebody else's key gets **404, not 403**: whether another
integration exists in the workspace is itself information, and there is no
reason to leak it to justify a refusal.

## Non-goals

- No new role between `member` and `owner`.
- No change to how a key authenticates, to `removeMember`'s bulk revoke, or to
  `WorkspaceScopeGuard`'s live membership check. Those three already guarantee
  "member key = member authority, and it dies with the membership".
- No CLI change — it calls the same routes, so it opens to members for free.

## Tasks

- [x] `ApiKeyService.list(workspaceId, { createdBy? })` + expose `createdBy` in
      the selection
- [x] `ApiKeyService.revoke(id, workspaceId, { createdBy? })` raising
      `NotFoundException` when nothing matched
- [x] `ApiKeyController`: `assertMember` on all three, owner-or-self scoping
- [x] Backend tests: service scoping + controller gating
- [x] Frontend: drop the `isOwner` gate on the API Keys section, add an
      owner-only `Created by` column
- [x] `ApiKey` type gains `createdBy`
- [x] Docs: `packages/backend/README.md` API Keys table, `docs/design/rest-api.md`

## Review

Three things came out differently from the plan.

**No `isOwner` helper.** `assertMember` already returns the member row, role
included, so the controller reads the role off the query that authorized the
request. A second `isOwner()` query would have been one more round trip for a
value already in hand. The whole branch is a private `keyScope()` that asserts
membership and returns `{}` or `{ createdBy }`.

**`updateMany`, not `update`.** `update`'s `where` accepts only unique fields
plus the extended-unique compound; adding `createdBy` to narrow the revocation
does not fit that, and `update` would have thrown `P2025` for a nonexistent row
anyway — a Prisma error to translate rather than a decision. `updateMany`
returns a count, so "did this caller own that key" is one readable branch.
Re-revoking an already-revoked key still succeeds, as before.

**The revoke button needed no per-row gating.** The plan had it gated on
`isOwner || own key`, but the server only ever returns keys the caller may
revoke, so every row rendered is revocable. Gating in the UI would have been a
second, drifting copy of a rule the API already enforces.

Scope creep avoided: the `Created by` column renders only for an owner. A
member's rows are all their own, so the column would have been a repeated
username in every row.

### Code review

Three reviewers (authorization, correctness, history/conventions). The
authorization lens confirmed the premise by walking every `/api/v1` controller:
each mounts `WorkspaceScopeGuard`, manager-gated routes re-derive `member.role`
live through `assertMember`, `scopes` is `@IsIn(['read','write'])` under a
`forbidNonWhitelisted` pipe, and key management itself is JWT-only — so a
`Bearer wfb_` token cannot mint or revoke keys. It also established that **no
role-demotion endpoint exists**: a role is fixed at invite acceptance, and
`removeMember` (the only membership-ending path) revokes the departing user's
keys in the same transaction. Two blocking findings, both fixed:

**The e2e test asserted the old rule.**
`test/api-key-http.e2e-spec.ts` expected `403` for a member's create. Unit
specs had been updated; this one was missed, and `verify:fast` does not run the
DB lane, so nothing local caught it — it would have failed CI's
`verify-integration`. Rewritten to assert the new model end to end (member
mints; member's list is their own; owner's is everyone's; a member revoking the
owner's key gets 404; both revoke their own), and run against a live Postgres:
5/5 pass.

**`revoke` returned an empty body.** Moving to `updateMany` dropped the return
value while the controller still returned it, so `wafflebase api-keys revoke`
printed `null` and broke the CLI schema's declared `response: { id }`. Fixed by
reading the revoked row back through an explicit selection — deliberately not
by restoring `update`'s default return, which had been handing back
`hashedKey`.

Doc staleness the history lens found — five sites, none in the original diff,
all written when owner-only minting was treated as load-bearing:
`docs/design/backend.md`, `docs/design/cli.md`,
`docs/design/agentic-office-workflow.md`, and comments in
`api/v1/documents.controller.ts` and `api/v1/folders.controller.ts`. Each said
minting is owner-only and therefore a key's holder is an owner. The gating
logic never depended on that (it resolves the role per request), but left alone
the text is what would make the next reader think this change contradicts the
two hardening commits that wrote it. All five updated.
