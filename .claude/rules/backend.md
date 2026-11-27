---
paths:
  - "packages/backend/**"
---

# Backend

- `nest start` loads workspace engines from their built `dist`. After changing core/docs/sheets/slides/board, run `pnpm core build && pnpm --filter @wafflebase/docs build && pnpm sheets build && pnpm slides build && pnpm --filter @wafflebase/board build`, or it fails with "Cannot find module".
- Schema change: `pnpm --filter @wafflebase/backend exec prisma migrate dev --name <name>` (`pnpm backend migrate` hardcodes `--name init`). Apply existing migrations with `pnpm --filter @wafflebase/backend exec prisma migrate deploy`. `postinstall` runs `prisma generate`.
- Unit tests: `pnpm backend test` (Jest).
- `pnpm backend test:e2e` runs DB suites only with `RUN_DB_INTEGRATION_TESTS=true` and `DATABASE_URL`; Yorkie suites also need `RUN_YORKIE_INTEGRATION_TESTS=true` and `docker compose up -d`; lakehouse suites need `RUN_LAKEHOUSE_INTEGRATION_TESTS=true`.
- e2e `clearDatabase` (`test/helpers/integration-helpers.ts`) deletes every row: point `DATABASE_URL` at a scratch database, never the dev DB.
- Nest CLI commands (`seed:templates`, `sync:templates`, `register:templates`) run from `dist`; use their `:build` variants. `tsx` emits no `design:paramtypes`, so DI injects `undefined`. Only `template:dump` runs through `tsx`.
- `/api/v1` controllers: use `@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)`; the last refuses POST/PUT/PATCH/DELETE without the key's `write` scope.
- Nest new v1 routes under `/workspaces/:workspaceId` so `WorkspaceScopeGuard` can check the key's workspace.
- A resource the caller may not see answers 404, not 403.
- Yorkie auth webhook (`src/document/yorkie-auth.controller.ts`):
  - Never register `CreateRevision`: Yorkie sends `attributes: null` and `decide()` fails closed for everyone.
  - `AttachDocument` is authorized as a read despite verb `rw` (`READ_GATED_METHODS`).
  - `ListRevisions`/`GetRevision` need editor-or-member (`REVISION_READ_METHODS`).
  - Only `YORKIE_AUTH_WEBHOOK_ENFORCE=false` selects shadow mode (`src/yorkie/yorkie-auth-enforcement.ts`).
  - Setup steps: `packages/backend/README.md`.
- `pnpm backend lint` runs `eslint --fix` and is in no verify lane. Check-mode it manually: `pnpm --filter @wafflebase/backend exec eslint "{src,apps,libs,test}/**/*.ts"`.
