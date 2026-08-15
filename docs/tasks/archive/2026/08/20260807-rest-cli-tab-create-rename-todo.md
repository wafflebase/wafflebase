# REST + CLI tab create / rename

## Goal

Expose tab (worksheet) **create** and **rename** through the REST API v1 and the
`wafflebase` CLI. Today `tabs` is read-only (`GET` only), so agents/scripts can
list tabs but cannot add or rename them. This unblocks multi-tab document setup
from the CLI (e.g. a "Summary" + "History" two-tab layout).

## Design

Yorkie spreadsheet root shape (already used by `cells.controller` / `tabs.controller`):
- `root.tabs[tabId]: TabMeta` — `{ id, name, type, kind? }`
- `root.tabOrder: string[]` — display order
- `root.sheets[tabId]: Worksheet` — cell data (`createWorksheet()`)

Create mirrors the frontend `addSheetTab` mutation exactly:
```ts
r.tabs[tabId] = { id, name, type: 'sheet' }
r.tabOrder.push(tabId)
r.sheets[tabId] = createWorksheet()
```
Rename mirrors `handleRenameTab`: validate tab exists, `normalizeTabName`, reject
blank, keep names unique.

### Shared helpers move
`normalizeTabName` / `isTabNameTaken` / `getUniqueTabName` /
`getNextDefaultSheetName` / `buildTabNameNormalizationPatches` + a new
`generateTabId` currently live in frontend `app/documents/tab-name.ts`. They are
pure functions over `TabMeta` — relocate into `@wafflebase/sheets`
(`model/workbook/tab-name.ts`), export from the package index, and make the
frontend file re-export from there (keeps existing importers working, gives the
backend access). Frontend `document-detail.tsx` drops its local `generateTabId`.

## Endpoints

- `POST /api/v1/workspaces/:wid/documents/:did/tabs`
  body `{ name?: string, type?: 'sheet' }` → `{ id, name, type }`
  - name omitted → `getNextDefaultSheetName`; provided → `getUniqueTabName`
  - **a duplicate name never 409s here** — it is de-duplicated to
    `"<name> (2)"` and returned in the response. Create is idempotent-ish by
    design so a script can post the same name twice without branching; only
    rename can conflict, because a rename has one specific tab it must land on
    and no free suffix to take.
  - 400 if `type` is anything other than `"sheet"`
- `PATCH /api/v1/workspaces/:wid/documents/:did/tabs/:tabId`
  body `{ name: string }` → `{ id, name, type }`
  - 404 if tab missing; 400 if name blank
  - **409 if another tab already holds that name** (case-insensitive, after
    trim; renaming a tab to its own current name is not a conflict)
- Both, plus `GET .../tabs`: 400 if the document is not a `sheet`.

## CLI

- `wafflebase sheets tabs create <doc-id> [name] [--type sheet]`
- `wafflebase sheets tabs rename <doc-id> <tab-id> <name>`
- http-client `createTab` / `renameTab`; schema registry entries; update
  `sheets-*` skill / README command tree.

## Tasks

- [x] Move tab-name helpers into `@wafflebase/sheets`; add `generateTabId`; export; rewire frontend
- [x] Backend: `POST` create + `PATCH` rename in `tabs.controller.ts` (TDD: e2e spec)
- [x] CLI: `create` / `rename` commands + http-client + schema registry
- [x] CLI skill/README doc update
- [x] `pnpm verify:fast` green
- [x] Self code-review over branch diff; address blocking findings
- [x] Rebase on origin/main; open PR (Summary + Test plan)

## Test plan

- sheets unit: tab-name helpers still pass after move
- backend e2e: create adds tab to `tabOrder`+`tabs`+`sheets`; rename updates name;
  rename missing tab → 404; blank name → 400; **rename to an existing name → 409**;
  created name uniqueness (create de-duplicates instead of conflicting);
  **list/create/rename on a non-`sheet` document → 400, without opening a
  Yorkie document**
- CLI: `tabs create`/`rename` dry-run shape; client call + body per subcommand;
  `--type` other than `sheet` rejected before both the request and the dry-run
  print; typecheck + unit
- manual: create + rename two tabs on the live "Mentee History" doc
