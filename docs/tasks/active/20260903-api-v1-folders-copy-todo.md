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

- [ ] `api/v1/folders.controller.ts` — `POST` / `GET` on
      `workspaces/:workspaceId/folders`, `PATCH` / `DELETE` on
      `workspaces/:workspaceId/folders/:folderId`, guarded by
      `CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard`
- [ ] A folder outside the route workspace answers 404, not 403 — the same
      shape `getDocumentOrThrow` uses for a document in another workspace
- [ ] Manager gating mirrors `ApiV1DocumentsController.remove()`: an API key
      acts with workspace authority (`ApiKeyWriteScopeGuard` already required
      `write`), a JWT caller is checked with `isDocumentManager`
- [ ] `POST api/v1/workspaces/:wid/documents/:documentId/copy` via
      `DocumentCopyService`, membership-gated only — a copy modifies nothing
- [ ] `PATCH api/v1/.../documents/:documentId` accepts `folderId`
      (`null` = workspace root), same-workspace-checked, manager-gated for JWT
- [ ] Unit specs for both controllers

### CLI

- [ ] `folders` namespace (alias `folder`): `list` · `create` · `rename` ·
      `move` · `delete`
- [ ] `docs copy <doc-id>` and `docs move <doc-id> [folder-id]` — `docs` is the
      generic document namespace (aliases `document` / `documents`), and both
      verbs work on every type
- [ ] `schema/registry.ts` entry for all seven, with aliases and safety: one
      that is in the commander tree but not the registry is invisible to the
      agents this surface exists for
- [ ] `--dry-run` previews for each, and tests

### Docs

- [ ] `docs/design/agentic-office-workflow.md` — A′ marked closed, open
      question 3 answered
- [ ] `docs/design/rest-api.md` — the new routes
- [ ] `docs/design/cli.md` + `packages/cli/README.md` — command tree + examples
- [ ] `docs/design/workspace-folders.md` — "v1 API deferred" no longer holds
- [ ] `packages/backend/README.md` — endpoint tables
- [ ] Tick step 4 of `20260831-agentic-office-workflow-todo.md`

## Out of scope

Classes B (18) and C (2). Nothing here is a new capability: every endpoint's
behavior already ships, only the way to call it without a browser is new.

## Review

_To be filled in when the work lands._
