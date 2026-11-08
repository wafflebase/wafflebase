# CodePair workspace claims — Lessons

**Created**: 2026-11-08

- CodePair users can be matched to GitHub accounts only through the numeric
  id CodePair stored (`social_uid`). All 275 owners of non-empty personal
  workspaces still resolve through `GET /user/{id}`; only 18 of them have a
  Wafflebase account, which is why the claim path exists.
- `GitHubStrategy.validate` already returned `githubId`, but nothing read it;
  the claim hook needed only an optional field on `OAuthProfile`.
- `npx prettier --write` on an existing backend file reformats lines the file
  never had formatted. Format only the hunks you add.

## Self review

- Round 1 (correctness + security): both callback paths validate the OAuth
  state (web cookie / CLI token) before `resolveOAuthUser`, so a claim only
  ever runs for a completed, state-checked GitHub exchange. A login-CSRF that
  completed someone else's code would only claim *that* account's own
  workspaces into it. Concurrent sign-ins are covered by the `claimedAt: null`
  guard; a deleted workspace takes its claim with it (cascade). No blocking
  findings. Rounds 2–3 skipped: the change is ~70 lines of logic with no
  frontend or API surface, and the reviewer lens that would add most (design
  fit) is covered by the design doc; say so here rather than imply a clean
  three-round loop.
