# Lessons

- Keep verification lanes centralized at the root so agents and humans run the
  same commands locally and in CI.
- Prefer non-mutating lint scripts (`lint:check`) in CI to avoid hidden code
  edits during verification.
- PR templates should require command-level evidence, not just checklist marks,
  so reviewers can audit agent-run validation quickly.
- When introducing a stricter gate, first confirm the current repository
  baseline is clean enough for that gate; otherwise ship the lane now and stage
  the stricter check as a follow-up debt paydown.
- Before finalizing any commit, run
  `git show --no-patch --pretty=%B HEAD | awk 'length($0)>80{print}'` and
  rewrite body paragraphs until no line exceeds 80 characters.
