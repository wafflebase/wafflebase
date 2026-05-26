# Contributing to Wafflebase

Thanks for considering a contribution! Wafflebase is a web-based
collaborative office suite (Sheets, Docs, Slides) built on Yorkie CRDTs
and Canvas rendering. This guide describes how we accept changes, how
the verification lanes work, and how AI coding agents fit into the
workflow.

## TL;DR

- **Bug fix** → file an issue (or skip for trivial fixes) → branch from
  `main` → `pnpm verify:fast` green → open a PR.
- **Feature / non-trivial change** → write or update a design doc under
  [`docs/design/`](docs/design/README.md) → create a task plan under
  [`docs/tasks/active/`](docs/tasks/README.md) → implement → open a PR
  that includes the design doc and the code.
- **Docs / refactor** → straight to PR.

All PRs target `main`. CI runs `verify:self` and `verify:integration`
and posts a summary as a PR comment.

## Before you start

1. Search [open issues](https://github.com/wafflebase/wafflebase/issues),
   open PRs, and existing design docs for related work. If a PR is
   already open for the issue you wanted to tackle, leave a comment
   there instead of opening a parallel PR — maintainers will close
   later duplicates with a pointer to the earlier one.
2. **Claim the issue before you start.** Leave a comment on the issue
   saying you'll take it; a maintainer will assign you. If you go
   silent for more than 3 days, we may un-assign so someone else can
   pick it up. This keeps multiple contributors from racing on the
   same fix.
3. For larger changes, open an issue or a discussion first so we can
   align on scope before you spend time on code.
4. By contributing, you agree your changes are licensed under the
   project's [Apache License 2.0](LICENSE). A CLA is **not** required
   today; we may introduce one in the future.

## Contribution paths

### Bug fixes

1. File a bug using the [bug report template](.github/ISSUE_TEMPLATE/bug-report.md)
   if one doesn't already exist. Include reproduction steps, expected vs.
   actual behavior, and environment.
2. Branch from `main`, fix the root cause (no temporary patches), and
   add a regression test where it makes sense.
3. Open a PR referencing the issue.

### Features and non-trivial changes

Wafflebase keeps design and execution in the repository:

- **Architecture / data-model changes** belong in
  `docs/design/<area>/<topic>.md`. See the
  [Design Documents index](docs/design/README.md) and the
  [template](docs/design/template.md). Update the existing doc when
  evolving an area instead of creating parallel files.
- **Per-task execution plans** belong in
  `docs/tasks/active/YYYYMMDD-<slug>-todo.md`, with a paired
  `…-lessons.md` capturing what surprised you (see
  [`docs/tasks/README.md`](docs/tasks/README.md)).

Design and code can ship in the **same PR**; we do not require a
separate spec PR. For very large or controversial changes, open a
design-only PR first to get architectural alignment before writing
code.

After the task is merged, archive it:

```bash
pnpm tasks:archive
pnpm tasks:index
```

### Documentation, refactors, small chores

Open a PR directly. Mention the motivation in the PR body.

## Local development

Setup, prerequisites, and the dev server are documented in the
[root README](README.md#getting-started) and the
[backend README](packages/backend/README.md). Don't duplicate them here
— if those instructions are wrong, fix them at the source.

## Verification gates

We have three verification lanes; pick the one matching the scope of
your change.

| Command                          | When to run                                                      |
| -------------------------------- | ---------------------------------------------------------------- |
| `pnpm verify:fast`               | Before every commit. Lint + unit tests; the pre-commit gate.     |
| `pnpm verify:self`               | Before opening a PR. Adds full builds, chunk budgets, visual + entropy checks. |
| `pnpm verify:integration:docker` | When touching backend, datasource, share-link, or Yorkie code paths. Spins up Postgres + Yorkie automatically. |

CI re-runs `verify:self` and `verify:integration` on every PR and posts
a per-lane summary comment. The two checkboxes in the PR template
must be green (or the skip reason filled in) before review.

## Commit messages

- **Subject ≤ 70 chars**, sentence case, no trailing period. Describe
  *what* changed.
- **Blank line**, then a body wrapped at ~80 chars explaining *why*.
- In a shell, use multiple `-m` flags or a `$'...'` literal for real
  newlines — never `\n` inside a `"..."` quoted message.
- Each commit should leave `pnpm verify:fast` green.

Example:

```text
Remove the synced seq when detaching the document

To collect garbage like CRDT tombstones left on the document, all
the changes should be applied to other replicas before GC. For this,
if the document is no longer used by this client, it should be
detached.
```

## Pull Request workflow

1. **Branch.** Cut a feature branch from up-to-date `main`.
2. **Implement and self-verify.** `pnpm verify:fast` per commit;
   `pnpm verify:self` (and `verify:integration:docker` where relevant)
   before pushing.
3. **Self review.** Run a code review skill over the full branch diff
   before opening the PR — `/code-review`,
   `superpowers:requesting-code-review`, or `/ultrareview`. Apply
   blocking findings; note non-blocking ones in the PR body as known
   limitations.
4. **Rebase.** `git fetch && git rebase origin/main` to surface
   conflicts before pushing.
5. **Open the PR.** Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md).
   - Title ≤ 70 chars.
   - Body should answer *why* and include a test plan; attach
     screenshots/recordings for UI changes.
   - Tick the `verify:self` and `verify:integration` checkboxes once CI
     reports green (or fill in the skip reason).
6. **Merge.** Once CI is green and review is approved, capture lessons
   in `*-lessons.md`, archive the task, and merge.

We don't require a per-PR `CHANGELOG` entry — release notes are
generated from merged PRs at release time
(`gh release create --generate-notes`). See
[MAINTAINING.md](MAINTAINING.md) for the release process.

## Code review

- Reply **inside the comment thread**, not at the top level of the PR,
  so context stays attached:

  ```bash
  gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies \
    -f body="reply text"
  ```

- Evaluate each finding technically. Push back with reasoning when a
  suggestion is wrong; agree explicitly when it is right. Performative
  agreement wastes everyone's time.
- If `main` moved during review, rebase again before pushing fixes.
- **Stalled reviews.** If actionable review feedback goes unaddressed
  for more than 7 days, a maintainer may close the PR to keep the
  queue clean. Reopen it whenever you address the feedback — there is
  no penalty for re-opening, only for ignoring.

## AI agent–assisted contributions

Wafflebase is happy to accept work generated with help from coding
agents (Claude Code, Codex, Cursor, etc.). The repository ships
agent-facing instructions in [`CLAUDE.md`](CLAUDE.md) (also exposed as
`AGENTS.md` via symlink) and [`.superpowers/`](.superpowers/) skills.

Expectations:

- **You sign off on every line.** Before opening the PR, read the entire
  diff. You should be able to answer "why X instead of Y" for each
  change. "The AI wrote it that way" is not an acceptable response to
  review feedback — fix it, or counter with a concrete technical
  reason.
- **Match existing conventions.** Coding agents tend to regress to
  generic patterns and ignore project-local idioms. Before submitting,
  compare your changes against nearby code in the same package and
  reconcile mismatches. If a reviewer flags a convention break, fix it
  rather than re-prompting the agent until it sounds confident.
- **CI green ≠ done.** Run the change locally and exercise the affected
  feature, especially for UI work. Tests are not your reviewer.
- **Disclose AI assistance** in the PR body so reviewers know where to
  focus extra attention.
- Follow the same workflow as a human contributor: design doc → task
  plan → verify lanes → self review → PR.
- Do not commit secrets, generated lockfile churn, or auto-formatter
  drift unrelated to your change.
- `/ultrareview` (multi-agent cloud review) is user-triggered and
  billed; an agent cannot launch it for you. Use it on substantial
  changes when you want a second opinion before merge.

## Package-specific gotchas

A few things bite first-time contributors:

- **ANTLR generated files** in `packages/sheets/src/formula/` carry
  `@ts-nocheck`. Do not hand-edit or "fix" types — regenerate with
  `pnpm sheets build:formula` and commit the output.
- **Store abstraction** — all spreadsheet behavior must go through the
  `Store` interface, all document behavior through `DocStore`. Don't
  reach around them with ad-hoc persistence.
- **Integration / e2e tests** require `docker compose up -d` first
  (Postgres + Yorkie). The `:docker` verify variant launches both for
  you.
- **Frontend chunk budgets** are enforced by `verify:self`. Defaults
  live in `harness.config.json`; override locally with
  `FRONTEND_CHUNK_LIMIT_KB` / `FRONTEND_CHUNK_COUNT_LIMIT` only when
  intentionally landing larger bundles.

## Reporting security issues

Do **not** open a public issue for security vulnerabilities. Email the
maintainers privately first; we will coordinate disclosure.

## License

Wafflebase is licensed under the [Apache License 2.0](LICENSE).
Contributions are accepted under the same license. A Contributor
License Agreement (CLA) is not required today and may be introduced
later — we will announce ahead of time if that changes.

## Further reading

- [README.md](README.md) — project overview and setup
- [docs/design/README.md](docs/design/README.md) — architecture and design docs
- [docs/tasks/README.md](docs/tasks/README.md) — active and archived task plans
- [MAINTAINING.md](MAINTAINING.md) — release and maintenance
- [CLAUDE.md](CLAUDE.md) / `AGENTS.md` — agent-facing development conventions
