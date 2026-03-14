# Backend Dev Start Failure — Lessons

## Check Cache Files When Build Output Is Missing

- If a TypeScript/Nest build reports success but the output directory is empty,
  compare `deleteOutDir` and incremental cache placement before assuming the
  build command itself is wrong.

## Root Dev Scripts Must Use Watch Variants Explicitly

- In a multi-package workspace, do not assume each package `start` script is
  the right target for the root `dev` command. Wire `dev` to each package's
  explicit watch/source-runner script.

## Shared Workspace Packages Need Runnable Entries

- If backend/runtime code starts importing a workspace package at execution
  time, verify the package `main` / `exports` fields point at real built
  artifacts. Type-only imports can hide broken package entries for a long time.
