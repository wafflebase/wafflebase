# Yorkie Worksheet Shape Migration — Lessons

## Do Not Promise A Clean Dry Run If Yorkie Attach Has Side Effects

- If the migration path depends on attaching Yorkie documents directly, do not
  label a mode as dry-run unless it is genuinely side-effect free. Attaching an
  empty document can materialize it on the server, so inspection and mutation
  are not cleanly separable.

## Force Explicit Scope For Bulk Data Fixes

- One-off migration commands should require either a specific document id list
  or an explicit `--all` flag. Silent "migrate everything" defaults are too
  easy to trigger from habit.

## Match Script Runtime To Workspace Module Boundaries

- If a backend TypeScript script imports workspace packages that publish ESM,
  a CJS-oriented `ts-node` entrypoint will fail even when Jest and Nest builds
  pass. Verify the CLI entrypoint itself and use a runtime like `tsx` when the
  workspace module graph crosses ESM/CJS boundaries.
