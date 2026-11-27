---
name: ship-pr
description: "Use when opening, updating, or merging your own wafflebase PR after /self-review: rebase, PR body, Before→After, review replies, pre-merge task archive."
---

# Ship PR

Run after `/self-review` (`.claude/commands/self-review.md`) is clean or out of
rounds. For a brief that should go through the cloud pipeline instead, use
`/spec-to-pr` (`.claude/commands/spec-to-pr.md`).

## 1. Sync and push

- `git fetch && git rebase origin/main` to surface conflicts before pushing.
- `git push` triggers `.githooks/pre-push`, which runs `pnpm verify:self`
  (~2.5 min). Run the push in the background with a long timeout (300s+),
  then confirm it landed (`git status -sb` shows no ahead count, or
  `git ls-remote origin <branch>` matches `HEAD`).
- On failure, read the failing lane's reason in `.harness-reports/<lane>.json`.
  Do not trust another command's exit code in place of the hook's.

## 2. Open

- `gh pr create`. Title ≤70 chars, says what changed.
- Body: Summary, Test plan, Known limitations (non-blocking self-review
  findings), and Before → After when the change touches UI a phone renders
  (use the `pr-before-after` skill).
- End the body with the attribution line the session gives.

## 3. Request review

- Nothing reviews the PR automatically; `CLAUDE.md` (Task workflow) says
  which `@claude` comment to post if you want one.

## 4. Address review

- Evaluate each finding against the code. Push back with file:line evidence
  when it is wrong.
- Reply in the comment thread, not top-level:
  `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies -f body='...'`.
- If `main` moved, rebase again (step 1).

## 5. Before merge

- CI green and review approved.
- If UI changed, smoke it manually in `pnpm dev`.
- Capture lessons in the task's `docs/tasks/active/*-lessons.md`.
- `pnpm tasks:archive` (also regenerates the index via `pnpm tasks:index`).
- Commit the task files and `docs/tasks/README.md` together, then push.

## 6. Merge

- `main` uses a merge queue. A maintainer squashing someone else's PR uses the
  `maintainer-merge` skill.
- After merge, start a new session for the next task.
