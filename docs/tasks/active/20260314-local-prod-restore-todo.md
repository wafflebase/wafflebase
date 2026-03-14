# Local Production Restore Rehearsal

Restore production-backed PostgreSQL metadata and Yorkie spreadsheet documents
into the local development environment so worksheet migration can be rehearsed
against realistic data.

## Tasks

- [x] Inspect production deployment config to identify Yorkie source address and
  database credentials
- [x] Dump production PostgreSQL data and restore it into the local docker
  postgres instance
- [x] Copy the target Yorkie documents into the local Yorkie instance
- [x] Verify the local environment can enumerate restored documents and run the
  worksheet migration flow

## Review

### What Changed

- Identified the production backend wiring from the `wafflebase` deployment:
  the app points at the in-cluster PostgreSQL service and the `wafflebase`
  Yorkie project.
- Dumped production PostgreSQL from `deploy/postgres` into
  `/tmp/wafflebase-prod-20260314.dump`.
- Restored that dump into a separate local database,
  `wafflebase_prod_restore`, instead of overwriting the default local
  development database.
- Added `packages/backend/scripts/copy-yorkie-documents.ts` to copy existing
  Yorkie document roots from the production `wafflebase` project into the
  local Yorkie server.
- Narrowed `packages/backend/tsconfig.json` to `src/**/*.ts` after the new
  backend admin scripts caused `nest start --watch` / `pnpm dev` to fail with
  `TS6059` against files under `packages/backend/scripts/`.
- Used MongoDB metadata (`yorkie-meta.projects` / `yorkie-meta.documents`) to
  enumerate existing source document keys first, so the copy step only attached
  known-existing production Yorkie documents and avoided creating empty source
  documents by accident.
- Extended the worksheet migration rehearsal tooling to handle real Yorkie
  edge cases from restored production data:
  - flat current worksheet roots
  - tabbed documents whose `tabOrder` arrives as Yorkie metadata instead of a
    plain array
  - legacy list fields (`hiddenRows`, `rangeStyles`, `conditionalFormats`)
    that arrive as Yorkie object snapshots instead of arrays
  - raw `doc.toJSON()` snapshots that include unescaped control characters
- Hardened the migration write path to replace `sheets` field-by-field instead
  of assigning the entire nested worksheet map in one shot.

### Results

- Local PostgreSQL restore succeeded with `17` documents in
  `wafflebase_prod_restore`.
- Local Yorkie copy succeeded for `16` production document roots.
- `1` PostgreSQL document id existed without a matching source Yorkie document:
  `3fa2e260-d5c1-484a-8bc9-8af184978c12`.
- Verified the restored environment end-to-end by running the worksheet
  migration script against one restored legacy document:
  `4ca1ed51-1443-4dee-8575-f39035ad9eec`, which migrated successfully as
  `legacy-flat`.
- The first full rehearsal exposed one real-data edge case:
  `3f54103b-9ba0-446b-a13b-96331d6a4199` (`"Yorkie Task"`), which used a
  legacy tabbed worksheet shape plus Yorkie-specific snapshot artifacts.
- After widening the migration detector and sanitizing raw `toJSON()` snapshots,
  that document migrated successfully as `legacy-tabbed` with `2410` cells.
- The final full rehearsal completed with all restored documents already in the
  canonical shape:
  - `processed: 17`
  - `changed: 0`
  - `unchanged: 17`
  - `by kind: current=17`

### Verification

- `ls -lh /tmp/wafflebase-prod-20260314.dump`
- `PGPASSWORD=wafflebase psql -h localhost -p 5432 -U wafflebase -d wafflebase_prod_restore -c 'select count(*) as documents from "Document";'`
- `pnpm --filter @wafflebase/backend exec tsx scripts/copy-yorkie-documents.ts --database-url postgresql://wafflebase:wafflebase@localhost:5432/wafflebase_prod_restore --mongo-url mongodb://127.0.0.1:37017/yorkie-meta --project-public-key fbuqYRxotajGGzb3kUD6aX --source-rpc-addr http://localhost:38080 --source-api-key fbuqYRxotajGGzb3kUD6aX --target-rpc-addr http://localhost:8080`
- `DATABASE_URL=postgresql://wafflebase:wafflebase@localhost:5432/wafflebase_prod_restore YORKIE_RPC_ADDR=http://localhost:8080 pnpm --filter @wafflebase/backend migrate:yorkie:worksheet-shape --document 4ca1ed51-1443-4dee-8575-f39035ad9eec`
- `pnpm --filter @wafflebase/backend test -- worksheet-shape-migration.spec.ts`
- `pnpm --filter @wafflebase/backend exec tsx scripts/copy-yorkie-documents.ts --database-url postgresql://wafflebase:wafflebase@localhost:5432/wafflebase_prod_restore --mongo-url mongodb://127.0.0.1:37017/yorkie-meta --project-public-key fbuqYRxotajGGzb3kUD6aX --source-rpc-addr http://localhost:38080 --source-api-key fbuqYRxotajGGzb3kUD6aX --target-rpc-addr http://localhost:8080 --document 3f54103b-9ba0-446b-a13b-96331d6a4199`
- `DATABASE_URL=postgresql://wafflebase:wafflebase@localhost:5432/wafflebase_prod_restore YORKIE_RPC_ADDR=http://localhost:8080 pnpm --filter @wafflebase/backend migrate:yorkie:worksheet-shape --document 3f54103b-9ba0-446b-a13b-96331d6a4199`
- `DATABASE_URL=postgresql://wafflebase:wafflebase@localhost:5432/wafflebase_prod_restore YORKIE_RPC_ADDR=http://localhost:8080 pnpm --filter @wafflebase/backend migrate:yorkie:worksheet-shape --all`
- `pnpm dev`
