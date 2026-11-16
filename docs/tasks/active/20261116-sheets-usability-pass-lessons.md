# Sheets usability pass — lessons

- The browser tool's `type` action turns `\t` into spaces, so seeding a sheet
  needs explicit `Tab`/`Return` key actions; and Tab…Enter does not return to
  the starting column (the bug this task fixes), so seeding row-by-row drifts.
- A stale `packages/core/dist/tokens.css` drops newer tokens such as
  `--primary-hover`; rebuild core before any visual verification.
