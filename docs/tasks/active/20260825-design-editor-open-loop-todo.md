# Design Editor — open the loop for someone who is not us (PR 13)

**Goal:** a person who is not a wafflebase developer opens the design editor with
one command, changes something, and ends up with a pull request. No environment
knowledge, no `pnpm --filter`, no `gh auth login` as a precondition.

**Why now:** #960 made the editor worth showing — the component preview works,
class and token edits reach the screen, and `design-sandbox-bringup` explains how
to stand it up on another project. What none of that reaches is the *end* of the
loop. Edits land in the working tree and stop there, which is the review surface
for a developer and a dead end for anyone else.

## What already exists (verified 2026-08-25, do not re-derive)

| Thing | Where | Note |
| --- | --- | --- |
| Writes land in the working tree | `plugin/bridge.ts` `POST /commit` | all-or-nothing; refuses a partial batch |
| Which files an edit touched | `GET /transactions` → `{ id, ts, labels[], files[] }` | **in-memory for the dev-server lifetime**, deliberately not persisted |
| Human labels per edit | `client/edits.ts` `saveDiff` | `Button: Background Color · hover`, `--primary → butter.500`, `palette.butter.500` |
| Backups | `guard.backup()` | already under `node_modules/.cache/…` (#912) — nothing to do |
| A local PR opener with fork handling | `scripts/agent/spec-to-pr.mjs` | detects a fork and passes the base repo explicitly to `gh pr create`; follow its conventions |
| Sandbox needs no backend | `providers.tsx` + fetch guard | API base is `http://scene.invalid`; no DB, no Yorkie, no `docker compose` |

**The editor's whole vocabulary**, from `plugin/protocol.ts`: `class-rewrite`,
`token-value`, `token-add`, `token-rebind`, `palette-value`, `layout-props`,
`layout-insert`, `layout-remove`. Everything it can produce is one of these, and
every one of them is a source edit that has already been dry-run applied.

## The model: one command, two destinations

An observation made in the editor is one of two kinds, and the editor already
knows which:

- **It maps to an intent** → the edit *exists in source*, verified. Turning that
  into a spec would be a downgrade: exact, checked edits thrown away so something
  can re-derive them. → **direct PR.**
- **It does not** — "add a button that opens a dialog", "paginate this list".
  No intent invents behaviour; `layout-insert` places an element but wires no
  state or handler. → **a spec**, which the repo's existing pipeline implements
  (issue → `@claude fix` → `agent-implement.yml` → draft PR).

Both can come out of one session, and the command should say so:
*"3 style changes and 1 feature request — the first three go to a PR, the last to
an issue."*

**This task ships the first half only.** See the hand-off at the bottom.

## Scope

- [x] **1. `pnpm design`** — one command, from nothing.
      Checks Node (>= 22, `.nvmrc`), prepares pnpm via corepack, installs only if
      needed, builds `dist/shell` only if stale, starts Vite, opens the browser at
      `/__design-editor/`, prints one line saying what is on screen.
      Idempotent: someone who already has the environment runs the same command
      and it skips straight to the server.
      - [ ] **Not measured — full workspace install shipped.** `pnpm install` at the
            root is what the script runs. The filtered alternative
            (`--filter @wafflebase/design-sandbox...`) has to bring the frontend's
            dependencies too, because the sandbox aliases into
            `packages/frontend/node_modules`, so the saving is unknown rather than
            obviously large. Measure a cold clone both ways before changing it;
            until then the honest cost is "a few minutes the first time", which is
            what the script says.
- [x] **2. `scripts/design-pr.mjs`** — the ladder below, deterministic, no model.
- [x] **3. `.claude/skills/design-changes-to-pr/`** — for a person who already has
      Claude Code. Reads `GET /transactions` (intents, not a text diff), reads
      `git diff` of exactly those files as evidence, writes the title and body,
      then calls (2) with `--title` / `--body-file`. **Decoration, not mechanism**
      — the loop must close without it.
- [x] **4. Revise the design doc.** `design-editor-local-plugin.md` lists
      "no branch/PR creation" under Non-goals and #700 repeats it. The withdrawal
      was about a *hosted* pipeline holding a GitHub App / PAT. Running on the
      person's own machine, `git` and `gh` are already authenticated as them, so
      shelling out adds no credential surface. Record that, or the doc contradicts
      the code.
- [x] **5. Record the two-destination model** in the same doc, with the fork
      constraint below, so the spec half is a decision rather than a rediscovery.

## The ladder

Detected at runtime and descended automatically; the person never picks a tier,
and each rung says in one line why it is not the one above.

| Rung | Detected by | Does |
| --- | --- | --- |
| 0 · no Node | `process.versions.node` major < 22 | prints one install instruction, exits non-zero |
| 1 · git only | `gh --version` fails, or `gh auth status` fails | branch + commit + push → opens `…/compare/<branch>?expand=1` in the browser. **A PR without `gh auth login`** |
| 2 · `gh`, no push rights | `gh repo view --json viewerPermission` is not WRITE/ADMIN | `gh repo fork --remote` → push to the fork → `gh pr create --repo <upstream>` |
| 3 · push rights | otherwise | branch + commit + push + `gh pr create` |

Rung 1 is the important one: a browser is enough.

## Guardrails

This writes to someone else's repository and pushes. Non-negotiable:

- [x] Never commit on `main` / `master` — create a branch.
- [x] Commit **only the files the transaction log names**. The working tree may
      hold unrelated work; say so, and leave it alone.
- [x] Show the whole plan before doing anything (the review modal already dry-runs
      and diffs; reuse that surface rather than inventing a second one).
- [x] Never force-push, never overwrite an existing branch.
- [x] If `GET /transactions` is unreachable (server closed — the log is in memory),
      fall back to `git status` and **say that the list is less precise**.

## Non-goals

- The spec half (see hand-off). It depends on work that is not on `main` yet.
- Shipping the skill to foreign consumers. It calls a repo script; making that a
  package `bin` is the same decision as #700's open item 3 (ship source vs. build
  a library) and waits for it.
- Any change to what the editor can express. No new intent kinds.

## Verification

- [x] `pnpm design` end to end — installs skipped, stale shell rebuilt, Vite started,
      and the URL taken from what Vite actually printed (it landed on `:5175`, two
      ports off the default, which is exactly why the port is parsed rather than
      assumed).
- [x] Guardrail: unrelated dirty files → reported and left out of the commit.
      Driven against a stub bridge serving a two-file write log while the tree held
      four other changes; the plan committed the two and listed the four.
- [x] The working-tree fallback names whole paths. `parsePorcelain` had eaten a
      character of the first line — git writes `␠M package.json` for an unstaged
      modification, with a literal space in the status field, and trimming the whole
      output before splitting turned that into `ackage.json`. Reading
      `--porcelain=v1 -z` retires the problem and two more with it: git never escapes
      a path there, and a rename is two records rather than an ambiguous
      `old -> new`. Nine cases are pinned in `scripts/test/design-pr.test.mjs`,
      including a file actually named `untracked -> weird.ts`.
- [x] Rung 3 end to end — this task's own pull request was opened with
      `pnpm design-pr`.
- [ ] Rung 1 forced (`PATH` without `gh`) — compare URL opens, branch is pushed.
- [ ] Rung 2 forced against a repo with no write access.
- [ ] `pnpm design` from a cold clone in a temp directory, timed.

---

## Hand-off — the reporter → spec half

**For whoever is working on `20260821-debug-report-todo.md`.** That task's own goal
already covers this ("an agent writes the issue text, proposes how the batch splits
into PRs"); what follows is only the design-editor-side facts, so they do not have
to be rediscovered.

**Where the two meet.** `feat/debug-report-design-editor` (`1d07ab773`) mounts the
reporter *inside the scene frame* — not the shell, because `elementFromPoint` in
the shell returns the `<iframe>` and a report from there carries a picture and no
selector. That decision is what makes the design editor a usable intake for a
spec: a report already carries the selector, the capture and the session.

**What the design editor can and cannot answer.** Its vocabulary is the eight
intents listed above. If an observation maps to one, it is already a source edit
and belongs in the design PR path this task builds — please do not re-derive it as
a spec, since that discards a verified edit. If it does not map, it is yours.
The split is mechanical: an intent either applies or it does not.

**The constraint that will bite.** `agent-review-panel.yml` excludes fork PRs
("the auto-fix loop cannot push to a fork"), and the audience for the open loop is
by definition on a fork. So today an outside reporter can get an *issue* opened
and the chain stops there — no `@claude fix`, no draft PR. That is a real gap for
the "someone else tries it" story and needs a decision rather than a discovery:
either the pipeline gains a trusted path for fork-originated specs, or the loop
honestly ends at the issue for outsiders.

**What not to build.** The branch/commit/push/PR plumbing and its tier ladder are
in `scripts/design-pr.mjs` from this task. Call it with a title and body rather
than writing a second one.
