# Instruction context budget — todo

## Problem

Claude Code warns at session start:

> 5 instruction files add up to 154.1k chars, over the 150.0k-char total
> limit · largest: packages/backend/README.md (93.0k), docs/design/README.md
> (51.2k), CLAUDE.md (6.1k)

`CLAUDE.md` `@`-imports six READMEs (~182k chars in total). Only five
instruction files made it into the session; the sheets / docs / slides /
frontend READMEs were dropped, while the backend README, which is mostly an
operator env-var and API reference, filled the budget. So every session pays
~150k chars of attention on content that is irrelevant to most tasks, and the
package overviews that would help are the part that gets cut.

## Principles (from https://code.claude.com/docs/en/best-practices)

- **Keep CLAUDE.md short.** It loads into every session, so it holds only
  what Claude cannot work out from the code: verify commands, places where
  the code is misleading, decisions not in the repo, things corrected twice.
  Stay under ~200 lines.
- **Scope rules to one part of the codebase.** Area-specific rules go in
  `.claude/rules/<name>.md` with a `paths:` filter, so they load only when
  Claude works there.
- **Put team procedures in skills.** Only the name and description load
  every session; the body loads when the task calls for it.
- **Reference material stays as files** and is read on demand. Linking a
  path costs nothing; `@` makes it part of every session.
- **Verify with a check, not a claim:** `/context all`, `/doctor`,
  `/doctor prompt-audit`, and a reviewer who did not write the change.
- **Subagents buy parallelism and a fresh pair of eyes, not a smarter
  answer**, and every one costs tokens. Fan out only where the units are
  independent; give reviewers read-only tools; use a cheaper model for
  mechanical jobs.

## Target

- Always-loaded instruction text (global + project `CLAUDE.md` + imports)
  **≤ 30k chars**, down from ~155k loaded / ~182k requested. No warning.
- No load-bearing fact lost: every gotcha in the old imported content is
  either still always-loaded, in a path-scoped rule, in a skill, or reachable
  by a path `CLAUDE.md` names.
- READMEs keep serving humans unchanged in this PR (slimming the backend
  README is a separate, optional follow-up).

## Plan

Orchestration: the main session owns Phase 0, synthesis, and the human
checkpoint. Fan-out happens only where units share no files. Phase 3 writers
own disjoint files on one branch, so they do not need separate worktrees.

### Phase 0 — Baseline (main, sequential)

- [x] Record the baseline. Requested by `CLAUDE.md` + its imports (bytes):
      `CLAUDE.md` 6,213 · `docs/design/README.md` 51,525 ·
      `packages/backend/README.md` 93,671 · sheets 4,272 · docs 6,239 ·
      slides 9,250 · frontend 7,609 — **178,779** project-side, plus
      `~/.claude/CLAUDE.md` + `RTK.md` 3,783 (personal, out of scope).
      Loaded: 5 files / 154.1k chars; sheets/docs/slides/frontend dropped
- [x] List every `@` import: only the root `CLAUDE.md` imports (six
      READMEs); no nested `CLAUDE.md`, no `CLAUDE.local.md`, no
      `.claude/rules/`. The SessionStart hook (`scripts/hooks/session-prime.sh`)
      also injects a 5-line workflow reminder
- [x] Write the classification rubric the Phase 1 agents share:
      **A** always-loaded (command / repo-wide gotcha / decision) ·
      **B** path-scoped rule (gotcha for one package; name the glob) ·
      **C** procedure → skill · **D** reference, stays in its file and is
      read on demand · **E** stale or derivable from code → delete candidate,
      with file:line evidence

### Phase 1 — Parallel audit (read-only fan-out, 7 agents)

Each agent gets the rubric and one source, has read-only tools only, and
returns a table: excerpt/line range → class → destination → reason. It writes
no file.

- [x] Agent 1: `packages/backend/README.md` (93k; biggest payoff, so look
      hard for the few real gotchas buried in the env reference: Yorkie e2e
      gates, `dist` build before `nest start`, `CreateRevision` warning, …)
- [x] Agent 2: `docs/design/README.md` (an index; expected to be mostly D)
- [x] Agents 3–6: sheets / docs / slides / frontend READMEs, one each
- [x] Agent 7: `CLAUDE.md` itself plus the SessionStart hook text, checked
      against the best-practice test (is Task Workflow step 3–6 a skill? is
      the mobile Before→After block a skill? does anything duplicate the
      hook or `~/.claude/CLAUDE.md`?)

### Phase 2 — Synthesis + checkpoint (main)

- [x] Merge the 7 tables; resolve conflicts (the same fact classed
      differently); dedupe against existing memory and skills
- [x] Draft the target layout and its char budget:
      `CLAUDE.md` (A, with plain-path pointers to the READMEs) ·
      `.claude/rules/*.md` (B) ·
      skill(s) (C) · E list with evidence
- [x] Human checkpoint: covered by the up-front decisions (budget, skills,
      guard, workflow); no E deletion was applied, so none needed sign-off.
      Review the layout in the PR

### Phase 3 — Parallel write (disjoint files, ≤5 agents)

- [x] Writer A: rewrite `CLAUDE.md`: drop the `@` imports, keep plain path
      pointers ("read `packages/backend/README.md` before touching backend
      env / API"), fold in the approved A items
- [x] Writer B: `.claude/rules/*.md`, one file per package with a `paths:`
      glob, B items only, each a single imperative line
- [x] Writer C (only if approved): extract the procedure(s) into
      `.claude/skills/<name>/SKILL.md`, and leave a one-line pointer in
      `CLAUDE.md`
- [x] Writer D: dropped — READMEs stay as they are, except two wrong
      commands fixed by hand (backend build line missing `board`; sheets
      README `pnpm sheet` alias that does not exist)
- [x] Main: fold the results together and resolve any cross-file overlap

### Phase 4 — Verify (fresh eyes, not the writers)

- [x] Budget met: `verify:instruction-budget` reports 4.0k chars from 1
      file (was 174,507 from 7). Fresh-session `/context all` warning check
      left to the maintainer (interactive only)
- [x] Path-scoped load check: in a fresh session, open a backend file and
      confirm `.claude/rules/backend.md` loads; open a sheets file and
      confirm it does not
- Not run: `/doctor prompt-audit` and a fresh-session `/context all` (both
  interactive only); listed in the PR test plan for the maintainer
- [x] Read-only reviewer subagent (did not see Phases 1–3): diff the old
      imported content against the new layout and list any A/B fact that
      is now unreachable
- [x] Optional guard: `scripts/verify-instruction-budget.mjs` in
      `verify:fast` that fails when the always-loaded chars pass the budget,
      so the warning cannot come back silently
- [x] `pnpm verify:fast` green; `scripts/test` 449 pass / 0 fail
- [x] `/self-review`: clean at round 2
- [x] PR #1210

## Decisions

Budget 30k; extract skills; add the guard; run the fan-out as workflows
(maintainer, 2026-11-27).

## Review

- Always-loaded project instructions: 174,507 → 4,000 chars (7 files → 1).
- New: `.claude/rules/{backend,frontend,ui-design,docs-engine,slides,core,design-docs}.md`
  (all `paths:`-scoped), skills `ship-pr` and `pr-before-after`, guard
  `scripts/verify-instruction-budget.mjs` in `verify:fast` + a
  `verify:self` lane.
- Path scoping verified in two headless sessions: reading a backend file
  surfaced `.claude/rules/backend.md`; reading a sheets file did not.
- Audit workflow: 7 read-only agents, ~703k subagent tokens, 1m49s. Write
  workflow: 3 writers + 1 fresh reviewer, ~417k tokens, 2m55s.
- Known limitations: a `.claude/**`-only PR runs no CI lane by design, so an
  unscoped rule added alone is caught only by the pre-commit `verify:fast`.
  `scripts/hooks/session-prime.sh` still repeats CLAUDE.md lines (~600
  chars); left as is.
