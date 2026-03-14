# Local Hackerwins Access Prep — Lessons

## Keep Local Test Data Prep Isolated From The Default Dev Database

- When preparing restored production-like data for local UI testing, keep the
  work on `wafflebase_prod_restore` instead of mutating the default dev
  database. It avoids contaminating normal development flows and makes rollback
  cheap.

## Move Datasources With Documents When Consolidating A Workspace

- For local UI testing, moving only `Document.workspaceId` is not enough if
  any restored worksheet tabs reference datasource records. Move `DataSource`
  rows into the same workspace and author as the regrouped documents so the
  local app can still resolve datasource-backed tabs.
