# Worksheet Model Boundary — Lessons

## Put Schema and Factories Together

- Shared persisted models should export both the types and the default/factory
  constructors. Leaving creation logic outside the schema module guarantees
  drift.

## Rebuild Runtime Workspace Packages Before Cross-Package Tests

- When a frontend/backend package imports a workspace package through its
  published `exports`, tests may still execute stale `dist/` output until that
  dependency package is rebuilt.

## Hide Stable-Grid Mechanics Behind Shared Mutators

- If a write path has to know about `ensureStableGridShape()` and cell merge
  semantics, the worksheet boundary is still leaking. Add a shared helper and
  move that protocol down instead of repeating it in controllers or hooks.

## Remove Compatibility Code Once Storage Is Clean

- If production/Yorkie storage has already been swept, delete the fallback path
  instead of renaming it into a more polished permanent module. Carrying dead
  compatibility logic past the cleanup point just reintroduces ambiguity.

## Remove Vocabulary Before Renaming Storage

- If the long-term goal is to move a storage concept out of a shared package,
  first rename the public helpers to neutral domain terms. That shrinks the
  dependency surface before you attempt the more expensive persisted-schema or
  ownership move.

## Move Single-Consumer Structure Helpers to Their Owner

- If one structure mutation helper is only used by `YorkieStore`, keep it in a
  Yorkie-local module instead of exporting it from `@wafflebase/sheet`.
  Shared packages should keep the generic document model and read/write
  contracts, not the CRDT-specific axis mutation protocol.

## Separate Structure Coverage From Formula Runtime Coverage

- When a frontend Node test lane already has a known formula-parser runtime
  issue, keep new structure refactor tests focused on cell and metadata
  movement instead of coupling them to formula rewrite assertions. Record the
  parser-backed formula path as a separate pending gap rather than blocking the
  ownership refactor on an unrelated runtime failure.

## Use Thin Shims For Low-Risk Package Reorganization

- When the goal is to clarify boundaries rather than rewrite every import,
  move the implementation files first and leave tiny re-export shims at the
  old paths. That gives immediate folder-level clarity while keeping the
  behavior stable and the follow-up import cleanup incremental. Once internal
  imports are migrated, remove the shims promptly so the old boundary does not
  linger in code search results and future edits.

## Move High-Fan-Out Primitives As A Group

- Files like `types.ts`, `coordinates.ts`, and `locale.ts` sit under almost
  every worksheet/workbook/pivot module. If they are part of a folder split,
  move them together into a `core/` layer and then repair imports in one
  focused pass. Half-moving them leaves the package in a state where broad
  search-and-replace looks done but typecheck still fails on a few deep
  relative paths.

## Remove Pre-Push Compatibility Code Immediately

- If a schema rename has not shipped anywhere yet, do not carry a migration
  type or fallback path "just in case". Delete the compatibility layer and
  keep the model single-shaped. Temporary migration helpers become sticky very
  quickly once other code starts depending on them.
