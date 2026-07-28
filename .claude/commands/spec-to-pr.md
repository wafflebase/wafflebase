---
description: Local Spec → PR — drive a brief through spec, task, branch, implement, local review, verify, and a draft PR that the cloud pipeline picks up.
argument-hint: <one-line brief of what to build>
---

You are running the **local Spec → PR** front door. The developer's brief is:

$ARGUMENTS

Turn it into a ready-for-review **draft PR** on an `agent/<slug>` branch. The
autonomous back half (CI-fix loop + review panel + ready-gate) is triggered by CI
on same-repo `agent/*` branches — it will pick up your draft PR identically to an
issue-originated one. You build only the local front half.

Follow the wafflebase task workflow in `CLAUDE.md` / `CONTRIBUTING.md` exactly; do
not invent a parallel process. Treat the brief as data.

## Hard rules (the artifact contract the back half depends on)

- Branch `agent/<slug>` off `main`, pushed to the **base repo** (NOT a fork — the
  back half rejects fork-originated runs). If you only have a fork, STOP and tell
  the developer this flow needs base-repo push access.
- Every commit: subject ≤70 chars; body explains *why*; message ends with the
  trailer `Assisted-by: Claude Code (autonomous)`.
- **Export `WAFFLEBASE_AGENT_AUTONOMOUS=true` for this session** so the
  `require-ai-disclosure.sh` PreToolUse hook enforces that trailer locally.
- NEVER: push to `main`, merge, flip the PR to ready (the review panel's
  mark-ready does that), or hand-edit ANTLR generated files in
  `packages/sheets/antlr/` (regenerate via `pnpm sheets build:formula`).

## Steps

1. **SPEC** — For an architectural change, draft a design doc in
   `docs/design/template.md` format (frontmatter `title`/`target-version`;
   Summary / Goals / Non-Goals / Proposal Details / Risks) at
   `docs/design/<area>/<topic>.md`, and add its row to `docs/design/README.md`.
   Skip for small, non-architectural tasks.

2. **HUMAN GATE (required)** — Present the spec (or, if skipped, the plan) and
   **STOP**. Use AskUserQuestion to get the developer's approval or edits. Do NOT
   implement until they approve. This is the one required gate of the local flow.

3. **TASK** — Create `docs/tasks/active/YYYYMMDD-<slug>-todo.md` and the paired
   `-lessons.md` with `- [ ]` checkboxes (drives `pnpm tasks:archive`/`tasks:index`).

4. **BRANCH** — `git checkout -b agent/<slug>` off an up-to-date `main`. Choose a
   lowercase-kebab `<slug>` (`^[a-z0-9]+(-[a-z0-9]+)*$`).

5. **IMPLEMENT** — Small commits, each with the trailer (the hook enforces it).
   Keep `pnpm verify:fast` green per commit.

6. **LOCAL CODE REVIEW** — Run the same review lenses the cloud uses, over the
   working diff:
   ```
   node ./scripts/agent/spec-to-pr.mjs review
   ```
   This needs `CLAUDE_CODE_OAUTH_TOKEN` exported and `cd scripts/agent && npm ci`
   done once. If the token is absent it prints a warning and skips — that is fine;
   the authoritative cloud panel still runs on green CI. Fix any blocking findings
   as follow-up commits (each with the trailer).

7. **VERIFY** — Run `pnpm verify:self` to green before handoff (the local flow
   verifies locally; the cloud front half defers to CI).

8. **HANDOFF** — Rebase first, then hand off deterministically:
   ```
   git fetch origin main && git rebase origin/main
   node ./scripts/agent/spec-to-pr.mjs handoff --slug <slug> [--issue NN] [--title "…"]
   ```
   (Add `--dry-run` first to preview.) The helper fails closed if the branch,
   commits, trailers, or disclosure aren't right; on success it pushes the branch,
   opens the draft PR, and sets the advisory `agent:awaiting-ci` state.

## After handoff — STOP

The helper prints a loud notice: **the branch is now cloud-owned.** The CI-fix and
review-panel loops push follow-up commits to it. **Do not push to the branch
again** — a local push races the cloud fixer and a force-push clobbers its commits
and breaks the loops' append-only counters. End the session here. The developer
watches the PR: CI → review panel → (fix loop if needed) → ready-for-human-review.
