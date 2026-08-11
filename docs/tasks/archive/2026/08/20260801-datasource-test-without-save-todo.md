# DataSource: Test Connection Without Saving — Implementation Plan

**Goal:** Stop `Test Connection` from persisting a datasource. Add a body-based
validation endpoint so the New DataSource dialog can test a connection before
anything is written, which removes the duplicate-create and the orphan-row
problems at their root.

**Issue:** Test Connection creates a datasource before saving.

**Architecture:** Add `POST /workspaces/:workspaceId/datasources/test` that takes
the connection fields in the body and never touches Prisma. `DataSourceService`
grows a private `probe(config)` holding the connect/`SELECT 1`/close logic; the
existing id-based `testConnection(id)` (still used by the edit dialog) and the
new `testConfig(dto)` both delegate to it. The dialog drops its `savedId` state
entirely: `handleTest` validates, `handleSave` creates. No schema change.

**Tech Stack:** NestJS + class-validator (backend), React + TypeScript
(frontend), Jest (backend unit), Vitest (frontend unit).

## Global Constraints

- **No Prisma write on the test path.** `testConfig` must not create, update, or
  delete a row. That is the whole point of the change.
- **Authorization parity.** The new endpoint resolves the workspace and calls
  `assertMember`, exactly like `createInWorkspace`. It must not widen access.
- **Keep `createClient` as the test seam.** `datasource.service.spec.ts` mocks
  the private `createClient`; the refactor must keep that seam working.
- **The edit dialog keeps the id-based path.** `POST /datasources/:id/test`
  stays; `datasource-edit-dialog.tsx` is not touched.
- **Passwords never logged.** The probe takes a plaintext password from the
  request body — do not log the config, only the error.
- **Pre-commit gate:** `pnpm verify:fast`. Commit subject ≤70 chars, blank line
  2, body explains why.

---

### Task 1: Service — extract `probe`, add `testConfig`, unwrap `AggregateError`

**Files:**
- Edit: `packages/backend/src/datasource/datasource.service.ts`
- Edit: `packages/backend/src/datasource/datasource.dto.ts`
- Test: `packages/backend/src/datasource/datasource.service.spec.ts`

**Interfaces:**
- `TestConnectionDto` — `host`, `port?`, `database`, `username`, `password`,
  `sslEnabled?` (same validators as `CreateDataSourceDto` minus `name`).
- `DataSourceService.testConfig(dto: TestConnectionDto): Promise<{ success: boolean; error?: string }>`
- `private probe(config): Promise<{ success: boolean; error?: string }>`

Failed connections currently surface as `{"success":false,"error":""}` because
`client.connect()` throws an `AggregateError` whose `.message` is empty and whose
causes live in `.errors`. `probe` must flatten that into a readable message.

- [x] **Step 1:** Add `TestConnectionDto`.
- [x] **Step 2:** Extract `probe(config)` from `testConnection`; route the
      id-based path through it (decrypting the stored password first).
- [x] **Step 3:** Add `testConfig(dto)` calling `probe` with the plaintext body.
- [x] **Step 4:** Flatten `AggregateError` into a joined message.
- [x] **Step 5:** Tests — `testConfig` never touches Prisma; success and failure
      shapes; `AggregateError` produces a non-empty message; client always closed.

### Task 2: Controller — workspace-scoped test endpoint

**Files:**
- Edit: `packages/backend/src/datasource/datasource.controller.ts`

- [x] **Step 1:** Add `@Post('workspaces/:workspaceId/datasources/test')`
      mirroring `createInWorkspace`: `resolveId` → `assertMember` → `testConfig`.

### Task 3: Frontend — API client

**Files:**
- ~~Edit: `packages/frontend/src/api/datasources.ts`~~ — **superseded**, see below.

- [x] **Step 1:** ~~Add `testDataSourceConfig(workspaceId, payload)` posting to the
      new endpoint.~~ Keep `testDataSourceConnection(id)` for the edit dialog.

**Superseded during implementation.** It shipped as
`testWorkspaceDataSourceConfig(workspaceId, payload)` in
`packages/frontend/src/api/workspaces.ts`, not in `datasources.ts`. The split
is by SCOPE, not by subject: `workspaces.ts` already owned the
workspace-scoped datasource calls (`fetchWorkspaceDataSources`,
`createWorkspaceDataSource`) while `datasources.ts` owns the id-scoped ones
(`fetchDataSource`, `testDataSourceConnection`). The new endpoint is
`POST workspaces/:workspaceId/datasources/test`, so it belongs with its
neighbours. `docs/design/sheets/datasource.md` is the current contract.

### Task 4: Frontend — dialog drops `savedId`

**Files:**
- Edit: `packages/frontend/src/components/datasource-dialog.tsx`

- [x] **Step 1:** `handleTest` calls `testDataSourceConfig` only — no create.
- [x] **Step 2:** `handleSave` creates once; remove the `savedId` state and its
      reset. Disable the Test button while a test is in flight.

Both call sites (`datasource-list.tsx`, `datasource-selector.tsx`) share this
component, so they are fixed together.

### Task 5: Design doc

**Files:**
- Edit: `docs/design/sheets/datasource.md`

- [x] **Step 1:** Add the new endpoint to the API table and note that testing is
      save-free.

### Task 6: Verify

- [x] `pnpm verify:fast` green.
- [x] Self review over the branch diff; apply blocking findings.

## Out of Scope

- SSRF hardening (host allowlists). Pre-existing on the create/test paths and
  unchanged by this work.
- Cleaning up orphan rows already in production — a one-time data task, noted in
  the issue.
- The edit dialog and the legacy non-workspace `POST /datasources` endpoints.
