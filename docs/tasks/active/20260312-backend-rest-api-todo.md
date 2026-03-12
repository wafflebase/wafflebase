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

## Phase 2: Yorkie Service ✓

- [x] Add `@yorkie-js/sdk` to `packages/backend/package.json`
- [x] Create `yorkie/yorkie.types.ts` — `SpreadsheetDocument`, `Worksheet`, `TabMeta` (duplicated from frontend)
- [x] Create `yorkie/yorkie.service.ts` — singleton Yorkie Client, `withDocument(docId, cb)` pattern
- [x] Create `yorkie/yorkie.module.ts` — register as global module
- [x] Add `YORKIE_RPC_ADDR` to ConfigModule (via ConfigService.get with default)
- [x] Write unit tests for YorkieService (mock Yorkie client)

## Phase 3: REST API v1 Controllers ✓

- [x] Create `api/v1/api-v1.module.ts`
- [x] Create `api/v1/workspace-scope.guard.ts` — verify API key workspaceId matches `:wid` param
- [x] Create `api/v1/documents.controller.ts` — GET/POST/GET/:id/PATCH/:id/DELETE/:id under `/api/v1/workspaces/:wid/documents`
- [x] Create `api/v1/tabs.controller.ts` — GET `/api/v1/.../documents/:did/tabs` via YorkieService
- [x] Create `api/v1/cells.controller.ts` — GET/GET/:sref/PUT/:sref/DELETE/:sref/PATCH (batch) under `.../tabs/:tid/cells`
- [x] Register `ApiKeyModule`, `YorkieModule`, `ApiV1Module` in `app.module.ts`
- [x] Write unit tests for workspace-scope guard
- [x] Write integration tests (JWT + API key auth, CRUD operations)
- [x] Update `packages/backend/README.md` with new endpoints

## Verification

- [x] `pnpm verify:fast` passes
- [x] API key create → use → revoke flow works end-to-end (integration test)
- [ ] Cell CRUD via REST API merges correctly with live Yorkie document — requires Yorkie server
- [x] Integration tests pass with `docker compose up -d`
