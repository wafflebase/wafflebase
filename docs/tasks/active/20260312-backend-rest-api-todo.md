# Backend REST API — Task

## Goal
Implement API key authentication, Yorkie service, and REST API v1 endpoints
so external programs can read/write spreadsheet data. Design doc: `docs/design/rest-api-and-cli.md` sections 1–6.

## Phase 1: API Key Model + Auth ✓

- [x] Add `ApiKey` Prisma model (id, name, prefix, hashedKey, workspaceId, createdBy, scopes, lastUsedAt, expiresAt, revokedAt, createdAt)
- [x] Run `prisma migrate dev` to generate migration
- [x] Create `api-key/api-key.service.ts` — create (returns raw key once), list (prefix only), revoke (soft-delete)
- [x] Create `api-key/api-key.controller.ts` — POST/GET/DELETE under `/workspaces/:wid/api-keys`
- [x] Create `api-key/api-key.strategy.ts` — Passport strategy: hash token → lookup → validate expiry/revocation
- [x] Create `api-key/api-key-auth.guard.ts`
- [x] Create `api-key/combined-auth.guard.ts` — delegates to ApiKeyAuthGuard or JwtAuthGuard based on `Bearer wfb_` prefix
- [x] Create `api-key/api-key.module.ts` — register strategy, service, controller
- [x] Write unit tests for api-key service and combined auth guard

## Phase 2: Yorkie Service

- [ ] Add `@yorkie-js/sdk` to `packages/backend/package.json`
- [ ] Create `yorkie/yorkie.types.ts` — `SpreadsheetDocument`, `Worksheet`, `TabMeta` (duplicated from frontend)
- [ ] Create `yorkie/yorkie.service.ts` — singleton Yorkie Client, `withDocument(docId, cb)` pattern
- [ ] Create `yorkie/yorkie.module.ts` — register as global module
- [ ] Add `YORKIE_RPC_ADDR` to ConfigModule validation
- [ ] Write unit tests for YorkieService (mock Yorkie client)

## Phase 3: REST API v1 Controllers

- [ ] Create `api/v1/api-v1.module.ts`
- [ ] Create `api/v1/workspace-scope.guard.ts` — verify API key workspaceId matches `:wid` param
- [ ] Create `api/v1/documents.controller.ts` — GET/POST/GET/:id/PATCH/:id/DELETE/:id under `/api/v1/workspaces/:wid/documents`
- [ ] Create `api/v1/tabs.controller.ts` — GET `/api/v1/.../documents/:did/tabs` via YorkieService
- [ ] Create `api/v1/cells.controller.ts` — GET/GET/:sref/PUT/:sref/DELETE/:sref/PATCH (batch) under `.../tabs/:tid/cells`
- [ ] Register `ApiKeyModule`, `YorkieModule`, `ApiV1Module` in `app.module.ts`
- [ ] Write integration tests (JWT + API key auth, CRUD operations)
- [ ] Update `packages/backend/README.md` with new endpoints

## Verification

- [ ] `pnpm verify:fast` passes
- [ ] API key create → use → revoke flow works end-to-end
- [ ] Cell CRUD via REST API merges correctly with live Yorkie document
- [ ] Integration tests pass with `docker compose up -d`
