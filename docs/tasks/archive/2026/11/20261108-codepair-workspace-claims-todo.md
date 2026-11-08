# CodePair workspace claims

**Created**: 2026-11-08

Let a CodePair user with no Wafflebase account receive their migrated
personal workspace on their first GitHub sign-in. Design:
`docs/design/notes/notes.md` → P3 → Workspace claims.

## Plan

- [x] `WorkspaceClaim` model + migration (`githubId`, `workspaceId` unique, cascade)
- [x] `UserService.claimGithubWorkspaces(userId, githubId)` — per-claim
      transaction behind a `claimedAt: null` guard; owner upsert; author-less
      documents attributed to the owner
- [x] Call it from `AuthController.resolveOAuthUser` on GitHub sign-ins; a
      failure is logged and never fails the sign-in
- [x] Unit tests (service + controller)
- [x] Design doc P3 section rewritten (open questions answered, claims)
- [x] `pnpm backend test` (2,263 passed), doc index/link checks
- [x] PR (#1118, merged `41f3d4369`)

## After merge (operator, outside this repo)

- [x] Deploy (runs the migration): v0.6.14, 2026-11-08
- [x] Create the owner-less workspaces for the ~280 personal CodePair
      workspaces whose owners have no Wafflebase account, copy their notes,
      null the authors, insert one `WorkspaceClaim` per workspace. 279
      personal + 15 shared workspaces whose owner has no account: 294 claims.
- [x] Spot-check one claim end to end: moved to the v0.6.14 release task,
      since it waits for a real owner's first sign-in.
