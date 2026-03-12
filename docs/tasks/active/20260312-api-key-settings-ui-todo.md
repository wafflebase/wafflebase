# API Key Management in Workspace Settings — Task

## Goal
Add an "API Keys" section to the workspace settings page so owners can create,
view, copy, and revoke API keys from the UI. Backend CRUD already exists at
`/workspaces/:id/api-keys`.

Design context: `docs/design/rest-api-and-cli.md`

Depends on: Backend REST API (already complete on `feat/rest-api-and-cli` branch).

## Phase 1: Frontend API Layer

- [ ] Add `ApiKey` and `ApiKeyCreateResponse` types to `packages/frontend/src/api/workspaces.ts`
- [ ] Add `fetchApiKeys(workspaceId)` — `GET /workspaces/:id/api-keys`
- [ ] Add `createApiKey(workspaceId, { name })` — `POST /workspaces/:id/api-keys`
- [ ] Add `revokeApiKey(workspaceId, keyId)` — `DELETE /workspaces/:id/api-keys/:id`

## Phase 2: Workspace Settings UI

- [ ] Add "API Keys" section to `workspace-settings.tsx` (between Invites and Danger Zone)
- [ ] Owner-only visibility (same `isOwner` check as Danger Zone)
- [ ] Table: Name, Key prefix (`wfb_xxxx...`), Created, Last used, Actions (revoke)
- [ ] Empty state: "No API keys." message
- [ ] "Create API Key" button → dialog with name input
- [ ] On create success: show raw key in dialog with copy button + "shown only once" warning
- [ ] Revoke button on each row (same pattern as invite revoke)

## Phase 3: Testing

- [ ] Check existing frontend test patterns and add tests if applicable
- [ ] Manual test: login → settings → create key → copy → verify in list → revoke

## Verification

- [ ] `pnpm verify:fast` passes
- [ ] Manual: create API key from UI, copy raw key, key appears in list, revoke works
- [ ] CLI test: `WAFFLEBASE_API_KEY=wfb_... npx tsx packages/cli/src/bin.ts doc list`
