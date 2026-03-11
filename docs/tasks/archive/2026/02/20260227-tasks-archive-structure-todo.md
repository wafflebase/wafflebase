# TODO

- [x] Define active/archive task storage contract and migration rules
- [x] Add automation scripts for archiving and index generation
- [x] Migrate existing task files into new folder structure
- [x] Update task/documentation references for new structure
- [x] Run archive/index commands and validate generated outputs
- [x] Document review and lessons
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added task automation scripts:
  - `scripts/tasks-archive.mjs`: moves completed tasks to
    `tasks/archive/YYYY/MM/`, keeps tasks with unchecked todo items in
    `tasks/active/`.
  - `scripts/tasks-index.mjs`: regenerates `tasks/README.md` and
    `tasks/archive/README.md`.
- Added root package commands:
  - `pnpm tasks:index`
  - `pnpm tasks:archive`
- Migrated existing task history:
  - All completed legacy `tasks/YYYYMMDD-*.md` files moved to
    `tasks/archive/2026/02/`.
  - Current in-progress task remains in `tasks/active/` during execution.
- Updated project docs for new task structure:
  - `CLAUDE.md` task documentation section
  - `design/harness-engineering.md` task record path notes
- Validation:
  - `pnpm tasks:archive` (pass)
  - `pnpm tasks:index` (pass)
  - Verified generated `tasks/README.md` and `tasks/archive/README.md` links.
