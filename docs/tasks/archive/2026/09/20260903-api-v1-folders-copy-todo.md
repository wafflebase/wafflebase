# Class A′ — reach folders, copy and move-to-folder without a browser

Issue: [#998](https://github.com/wafflebase/wafflebase/issues/998) —
`@claude fix "A′ — backend has it, but outside /api/v1 and JWT-only (7)"`
Design: [agentic-office-workflow.md](../../design/agentic-office-workflow.md) §A′
Predecessor: class A closed in #999 (`7deb054`)

## The gap

Seven capabilities the web editor uses daily have a backend, but only behind
`JwtAuthGuard` on a bare `@Controller()`:

| Item | Today |
| --- | --- |
| Folder create / list / rename / move / delete (5) | `folder.controller.ts:22-23` |
| Document copy (1) | `document.controller.ts:296` |
| Document move to folder (1) | `document.controller.ts:310,348` |

`jwt.strategy.ts` also reads a Bearer header, so a `wafflebase login` session
reaches them; an **API key cannot**, because `/api/v1` is the only surface
`CombinedAuthGuard` is mounted on. So the group does not close with a CLI
command alone — it needs the endpoints to exist under `/api/v1` first.

## Decision (answers open question 3)

**Agent-facing automation must work under an API key**, so the close is an
`/api/v1` surface rather than widening the guard on the web controllers:

- `WorkspaceScopeGuard` is what makes an API key safe — it refuses a key minted
  for another workspace. The web folder routes are `folders/:id` with no
  workspace in the path, so there is nothing for that guard to check. Nesting
  them under `workspaces/:workspaceId/folders` is what makes the key's scope
  enforceable, and it is the shape the `/api/v1` surface already uses.
- Swapping `CombinedAuthGuard` onto `folder.controller.ts` instead would leave
  `PATCH folders/:id` reachable by any key for any workspace's folder.
- The web controllers keep their JWT-only routes untouched: the frontend calls
  them, and this must not change what a browser session can do.

## Plan

### Backend

- [x] `api/v1/folders.controller.ts` — `POST` / `GET` on
      `workspaces/:workspaceId/folders`, `PATCH` / `DELETE` on
      `workspaces/:workspaceId/folders/:folderId`, guarded by
      `CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard`
- [x] A folder outside the route workspace answers 404, not 403 — the same
      shape `getDocumentOrThrow` uses for a document in another workspace
- [x] Manager gating mirrors `ApiV1DocumentsController.remove()`: every caller
      is checked with `isDocumentManager`. An API key is **not** waved past it
      — it carries the authority of `ApiKey.createdBy`, resolved against that
      user's membership at request time (`ApiKeyWriteScopeGuard`'s `write`
      scope is a separate, earlier gate)
- [x] `POST api/v1/workspaces/:wid/documents/:documentId/copy` via
      `DocumentCopyService`, membership-gated only — a copy modifies nothing
- [x] `PATCH api/v1/.../documents/:documentId` accepts `folderId`
      (`null` = workspace root), same-workspace-checked, manager-gated for JWT
- [x] Unit specs for both controllers

### CLI

- [x] `folders` namespace (alias `folder`): `list` · `create` · `rename` ·
      `move` · `delete`
- [x] `docs copy <doc-id>` and `docs move <doc-id> [folder-id]` — `docs` is the
      generic document namespace (aliases `document` / `documents`), and both
      verbs work on every type
- [x] `schema/registry.ts` entry for all seven, with aliases and safety: one
      that is in the commander tree but not the registry is invisible to the
      agents this surface exists for
- [x] `--dry-run` previews for each, and tests

### Docs

- [x] `docs/design/agentic-office-workflow.md` — A′ marked closed, open
      question 3 answered
- [x] `docs/design/rest-api.md` — the new routes
- [x] `docs/design/cli.md` + `packages/cli/README.md` — command tree + examples
- [x] `docs/design/workspace-folders.md` — "v1 API deferred" no longer holds
- [x] `packages/backend/README.md` — endpoint tables
- [x] Tick step 4 of `20260831-agentic-office-workflow-todo.md`

## Out of scope

Classes B (18) and C (2). Nothing here is a new capability: every endpoint's
behavior already ships, only the way to call it without a browser is new.

## Review

The work landed in **#1012** (`74bdafa16`, "Reach folders, copy and
move-to-folder without a browser"). All 16 boxes above were ticked on
2026-09-05, during the v0.6.9 archive audit — **not** when the PR merged.
Every one was re-verified against source before being ticked, not against
#1012's commit message:

**Backend.**
`packages/backend/src/api/v1/folders.controller.ts` exists with
`@Controller('api/v1/workspaces/:workspaceId/folders')` and the full guard
stack `@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)`,
plus all four handlers. The 404-not-403 rule is `folderInWorkspace()`
throwing `NotFoundException('Folder not found')`, pinned by
`folders.controller.spec.ts`'s "is not found … even for a write-scoped API
key" cases — which is the point: the key's *scope* must not be what leaks
the folder's existence. Manager gating is `isManager()` calling
`workspaceService.assertMember()` and then
`isDocumentManager(member.role, folder.authorID, userId)`, with specs
covering the demoted and removed minter, so a key really does carry its
creator's authority *as of the request* rather than as of minting.
`@Post(':documentId/copy')` is at `api/v1/documents.controller.ts:101`,
delegating to `documentCopyService.copy(...)`; `PATCH` reads `folderId`
independently of `title` and treats `null` as `disconnect`. Both
controllers have unit specs.

**CLI.** `packages/cli/src/commands/folders.ts` declares `.alias('folder')`
and the five subcommands; `docs.ts:174` and `:196` are
`copy <doc-id>` and `move <doc-id> [folder-id]`, with the explicit-null
move handled. All seven are in `schema/registry.ts`, which is the box that
mattered most — a command in the commander tree but absent from the
registry is invisible to the agents this whole surface exists for.
`packages/cli/test/folders.test.ts` covers the `--dry-run` preview for
every verb.

**Docs.** `agentic-office-workflow.md` marks A′ closed and strikes open
question 3 with "**Answered: an API key.**"; `rest-api.md`, `cli.md`,
`packages/cli/README.md`, `workspace-folders.md` (the "v1 API deferred"
line is gone) and `packages/backend/README.md`'s endpoint tables all
carry the new routes; step 4 of the agentic-office-workflow task is
ticked.

**The one lesson is the ticking itself.** This task sat at 16 unchecked /
0 checked for two days while every line of it was on `main`. It was the
single clearest instance the v0.6.9 audit found, and it is the same
failure mode v0.6.7 archived nine tasks out of and v0.6.8 wrote 90 lines
about. The pattern is not that people forget — it is that the PR is the
unit of attention and the task doc is not part of the PR's own checklist.
Recorded in the paired lessons file rather than only here.
