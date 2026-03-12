# API Key Management in Workspace Settings — Task

## Goal
Add an "API Keys" section to the workspace settings page so owners can create,
view, copy, and revoke API keys from the UI. Backend CRUD already exists at
`/workspaces/:id/api-keys`.

Design context: `docs/design/rest-api-and-cli.md`

Depends on: Backend REST API (already complete on `feat/rest-api-and-cli` branch).

## Phase 1: Frontend API Layer

- [x] Add `ApiKey` and `ApiKeyCreateResponse` types to `packages/frontend/src/api/workspaces.ts`
- [x] Add `fetchApiKeys(workspaceId)` — `GET /workspaces/:id/api-keys`
- [x] Add `createApiKey(workspaceId, { name })` — `POST /workspaces/:id/api-keys`
- [x] Add `revokeApiKey(workspaceId, keyId)` — `DELETE /workspaces/:id/api-keys/:id`

## Phase 2: Workspace Settings UI

- [x] Add "API Keys" section to `workspace-settings.tsx` (between Invites and Danger Zone)
- [x] Owner-only visibility (same `isOwner` check as Danger Zone)
- [x] Table: Name, Key prefix (`wfb_xxxx...`), Created, Last used, Actions (revoke)
- [x] Empty state: "No API keys." message
- [x] "Create API Key" button → dialog with name input
- [x] On create success: show raw key in dialog with copy button + "shown only once" warning
- [x] Revoke button on each row (same pattern as invite revoke)

## Phase 3: Testing

- [x] Check existing frontend test patterns and add tests if applicable
- [x] Manual test: login → settings → create key → copy → verify in list → revoke

## Verification

- [x] `pnpm verify:fast` passes
- [x] Manual: create API key from UI, copy raw key, key appears in list, revoke works
- [x] CLI test: `WAFFLEBASE_API_KEY=wfb_... npx tsx packages/cli/src/bin.ts doc list`
