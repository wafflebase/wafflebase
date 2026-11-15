# Board usability pass — lessons

- The dev server on :5173 may be served from a sibling worktree
  (`waffledocs`), not this one. Check which checkout Vite serves before
  judging visuals.
- After branching from a fresh `origin/main`, run `pnpm install` and rebuild
  `@wafflebase/slides` before the first commit: a stale `node_modules` or
  `dist` fails `verify:fast` in unrelated packages (frontend SDK-realm test,
  CLI typecheck on `@wafflebase/slides/node`).
