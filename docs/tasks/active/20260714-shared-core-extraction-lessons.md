# Shared Core Extraction — Lessons

Paired with [`20260714-shared-core-extraction-todo.md`](20260714-shared-core-extraction-todo.md).

## Decisions

- **One package, not two.** Original design proposed `@wafflebase/core` +
  `@wafflebase/ooxml`. Consolidated to a single `@wafflebase/core` with subpath
  exports (`/geometry`, `/canvas`, `/ooxml`, `/ooxml/drawingml`) to keep the
  package count low. Subpath entries + tree-shaking isolate the `jszip` weight,
  which was the only reason to split.
- **Behavior-preserving moves, not rewrites.** slides is the largest OOXML/
  DrawingML consumer; extraction promotes slides' existing code as canonical and
  migrates other engines to it, gated by slides' existing test suites.

## Lessons

- **Backend uses classic CommonJS resolution → `exports` subpaths invisible.**
  A *value* import of `@wafflebase/core/tokens` from docs/sheets source (which
  backend ts-jest compiles) failed `TS2307`; a slides `import type` of
  `@wafflebase/core/geometry` was erased and hid the same gap. Fix: map
  `@wafflebase/core/*` → `../core/src/*` in `packages/backend/tsconfig.json`.
  Any NEW core subpath needs the same. See [[project_core_package_subpaths]].
- **Slides typechecks against docs' built `dist`, not source.** A stale docs
  `dist` makes `verify:fast` fail with phantom `InlineStyle` errors; fix with
  `pnpm --filter @wafflebase/docs build`, not `--no-verify`. See
  [[project_slides_typecheck_gate_gap]].
- **Re-export beats mass import-rewrite for a type move.** Having
  `frame.ts`/`routing.ts`/`lasso.ts` re-export the shared type
  (`import type { X } … export type { X }`) single-sources the identity with
  zero churn on downstream importers and no public-API change.
- **Don't force a field-convention merge.** slides `{x,y,w,h}` vs sheets
  `{left,top,width,height}` are different conventions; unifying sheets would be
  a leaky abstraction, so sheets `Size` stayed put.
- **Branch got lost to a concurrent checkout.** After rebase, HEAD landed on
  `main` (3 commits directly on it) and the feature branch pointed at an old
  SHA. Recovered via reflog: `git branch -f`/`reset --hard` onto the rebased
  tip, reset `main` to `origin/main`. Nothing was pushed, so no remote impact.
  See [[project_concurrent_session_stash]].
