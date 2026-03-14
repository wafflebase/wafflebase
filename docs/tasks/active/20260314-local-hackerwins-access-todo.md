# Local Hackerwins Access Prep

Prepare the restored local dataset so the `hackerwins` account can open and
test the restored documents in the local app.

## Tasks

- [x] Inspect the restored database ownership and workspace relationships
- [x] Reassign or regroup the restored documents so the `hackerwins` account
  can access them from the local app
- [x] Start the local app against `wafflebase_prod_restore` and verify the
  prepared data path

## Review

### What Changed

- Inspected the restored `User`, `Workspace`, `WorkspaceMember`, `Document`,
  and `DataSource` tables to determine how access is granted in the local app.
- Confirmed that the local `hackerwins` account is `User.id = 1` and its
  primary workspace is `d4f6da6c-ce31-4354-b755-28714b240a3e`.
- Reassigned all `17` restored documents into the `hackerwins` workspace and
  set their `authorID` to `1`.
- Reassigned all `4` restored datasources into the same workspace and set
  their `authorID` to `1` so datasource-backed tabs continue to resolve inside
  the regrouped local test workspace.
- Started the local app with
  `DATABASE_URL=postgresql://wafflebase:wafflebase@localhost:5432/wafflebase_prod_restore pnpm dev`
  so the restored dataset is available in the browser.

### Results

- The restored local dataset is now concentrated in the `hackerwins`
  workspace.
- `Document` distribution after regrouping:
  - `d4f6da6c-ce31-4354-b755-28714b240a3e`: `17`
- `DataSource` distribution after regrouping:
  - `d4f6da6c-ce31-4354-b755-28714b240a3e`: `4`
- The local app is running against `wafflebase_prod_restore`.
- Frontend is available at `http://localhost:5173/`.
- Backend is available at `http://localhost:3000/`.

### Verification

- `PGPASSWORD=wafflebase psql -h localhost -p 5432 -U wafflebase -d wafflebase_prod_restore -c "select id, username, email from \"User\" order by id asc;"`
- `PGPASSWORD=wafflebase psql -h localhost -p 5432 -U wafflebase -d wafflebase_prod_restore -c "select id, name, slug from \"Workspace\" order by \"createdAt\" asc;"`
- `PGPASSWORD=wafflebase psql -h localhost -p 5432 -U wafflebase -d wafflebase_prod_restore -c "select \"workspaceId\", count(*) as documents from \"Document\" group by \"workspaceId\" order by documents desc;"`
- `PGPASSWORD=wafflebase psql -h localhost -p 5432 -U wafflebase -d wafflebase_prod_restore -c "select id, title, \"workspaceId\", \"authorID\" from \"Document\" order by \"createdAt\" asc;"`
- `PGPASSWORD=wafflebase psql -h localhost -p 5432 -U wafflebase -d wafflebase_prod_restore -c "select id, name, \"workspaceId\", \"authorID\" from \"DataSource\" order by \"createdAt\" asc;"`
- `DATABASE_URL=postgresql://wafflebase:wafflebase@localhost:5432/wafflebase_prod_restore pnpm dev`
