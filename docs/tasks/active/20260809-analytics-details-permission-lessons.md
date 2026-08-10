# Lessons — Analytics "Details" link 403s for non-manager members (#732)

## Notes

- The workspace analytics endpoint is member-gated while the per-document
  one is manager-gated. Whenever a list endpoint links into a
  narrower-gated detail endpoint, the list payload has to carry the
  detail endpoint's predicate — otherwise the UI can only discover the
  answer by failing. `isDocumentManager` already exists as the single
  source of that predicate, so the list just annotates with it (the same
  pattern `GET /documents` uses for `canManage`).

- `pnpm verify:fast` fails on a fresh checkout with `Cannot find module
  '@wafflebase/docs'` / `@wafflebase/slides/node` — the `slides` and
  `cli` typecheck lanes read their workspace deps from `dist/`, which an
  install alone does not produce. That is a stale-workspace symptom, not
  a reason to skip the gate: build the deps first and the lane goes
  green.

  ```bash
  pnpm --filter "@wafflebase/slides^..." build   # docs, core, sheets…
  pnpm --filter @wafflebase/slides build          # for the cli lane
  pnpm verify:fast                                # green
  ```

  The first pass on this task mistook that for an environment blocker
  and committed past the hook instead. Running the touched lanes
  individually and leaning on CI is not a substitute — the pre-commit
  `verify:fast` is the standard the repo expects (CLAUDE.md, task
  workflow step 2), and it passes here once the deps are built.

## Follow-ups

- None. The detail endpoint's manager gate is deliberately unchanged.
