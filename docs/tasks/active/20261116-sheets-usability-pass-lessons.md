# Sheets usability pass — lessons

- The browser tool's `type` action turns `\t` into spaces, so seeding a sheet
  needs explicit `Tab`/`Return` key actions; and Tab…Enter does not return to
  the starting column (the bug this task fixes), so seeding row-by-row drifts.
- A stale `packages/core/dist/tokens.css` drops newer tokens such as
  `--primary-hover`; rebuild core before any visual verification.
- Parallel worktree agents load the machine enough that cold-import tests
  blow the 5s vitest budget; size that budget for the import, never bypass
  the hook (`upload-queue-lazy-deps` got 30s).
- A filled cell's fill is authored, so its default ink must be too: theme
  ink on an authored fill fails in the theme it was not authored in.

## Self-review

- Round 1: 5 blocking (correctness ×2, test-adequacy ×2, blast-radius ×1).
  Fixed all: DV Done disabled on an optionless draft + Done-path test;
  financial sign decided numerically (ar-EG test); duplicate-tab `toJS` and
  error-toast tests; click rescue hit-tests so a revision preview over the
  live sheet keeps its clicks.
- Round 2: 6 blocking (design-fit, correctness ×3, test-adequacy,
  blast-radius). Fixed all: the round-1 "black ink on any fill" was too broad
  — now dark mode only, picked by contrast, shared with CellInput, documented
  in sheet-style.md; a press that began over an open layer is not rescued;
  the panels' getSelectionRange falls back to the active cell so a single
  cell drafts a rule; ChartEditorPanel X-axis picker tests.
- Lesson: a fix for one rendering case (pale CF fill) must be scoped to that
  case's cause (theme ink vs authored fill), not widened to every fill.
- Round 3: 1 blocking (test-adequacy: `commitEditForNameBox` untested).
  Added `worksheet-namebox-commit.test.ts`. Loop stopped at its 3-round
  bound; correctness, design-fit, security, docs and blast-radius were clean.
- `pnpm tasks:archive` sweeps every finished task in `active/`, not only this
  one; review its move list before committing, and never restore with a
  directory-wide `git checkout` (it reverted this task's own todo edit too).
