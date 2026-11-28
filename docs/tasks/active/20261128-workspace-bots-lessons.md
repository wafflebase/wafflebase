# Workspace Bots MVP — Lessons

Paired with [20261128-workspace-bots-todo.md](20261128-workspace-bots-todo.md).

## A written contract made four parallel implementers agree

Backend (two implementers), CLI + plugin, and frontend were built at the
same time against `20261128-workspace-bots-todo.md`. The integrator's
cross-package pass found route paths, bodies and response shapes already
lined up; the only drift was a nullable `owner` the backend chose for a
real reason and reported as a deviation.

**Rule:** before a parallel build, fix every cross-package shape, the
ownership of each file, and "report, don't improvise" in one shared file —
and have a single foundation step own the schema so nobody races on it.

## Implementers' open problems are the review's best leads

The `agent reply --body-file` auto-approve hole was first raised by the
CLI implementer as an open problem, then confirmed by both review lenses.
The `botLastSeenAt` vs 60 s *Listening* tension was raised by the frontend
implementer and fixed in the backend. **Rule:** ask every implementer for
"deviations" and "open problems" in a structured report, and feed them to
the integrator and reviewers verbatim.

## Self-review log

- Round 1: blocked on 5 (correctness, security ×2, blast-radius ×2). Fixed
  all: a claim whose caller left is released; bot keys scoped to the agent
  routes (`agent` scope + `@AgentKeyRoute()`); bot names unique among all
  members; member-removal impact counts owned bots and the private channels
  they share. Tests first for each; scratch-DB e2e 86/86.
- Round 2: blocked on 3 (design-fit, security ×2). Fixed all: one
  `removeBotsInTx` helper behind both bot-removal paths; a parked long-poll
  polls every 15 s once the listener is connected (1 s before) and a bot
  may hold 4 waits per replica (429 beyond); the listen skill replies via
  stdin with a quoted, task-id-keyed heredoc instead of a shell argument.
- Round 3: clean on all six lenses.
- PR panel (`@claude review`): 1 blocking — `agent thread` fed any channel
  member's replies into a session acting with the invoker's authority, with
  only a prose rule in between. Fixed with a server-side filter (invoker +
  bot messages only); also fixed the waiter-cap check-then-register race
  and a misplaced JSDoc. Other suggestions left in the PR.

## A rule the model reads is not a boundary

The listen skill said chat content is data, never instructions — and every
local review accepted that. The PR panel did not: the session acts with the
member's full authority, so who can write into its input is the boundary.
**Rule:** for any agent input, ask who can author it; if it is not the
principal whose authority the agent uses, filter it on the server.
