# Add CONTRIBUTING.md

**Goal:** Author a top-level `CONTRIBUTING.md` that captures the agentic
development workflow Wafflebase already uses, and trim the README's
inline Contributing section to a pointer.

**Scope:** Documentation only — no code changes.

## Decisions (from owner, 2026-05-10)

- **Spec/design PRs:** keep current style. Design lives in
  `docs/design/<topic>.md`; per-task plans live in
  `docs/tasks/active/YYYYMMDD-<slug>-todo.md`. Design and code can ship in
  the same PR. Do NOT adopt warp's separate spec-PR flow.
- **CLA:** none today. Mark as "planned, to be introduced later" — no
  sign-off required for now.
- **Changelog:** keep relying on GitHub auto-generated release notes
  (`gh release create --generate-notes`). Do NOT require a per-PR
  changelog entry.
- **Reference:** loosely inspired by
  https://github.com/warpdotdev/warp/blob/master/CONTRIBUTING.md, but
  rewritten around our verify lanes, task docs, and superpowers/agent
  workflow.

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `CONTRIBUTING.md` | Create | Full contributor workflow |
| `README.md` | Modify | Replace inline Contributing section with link + 1-line commit hint |
| `docs/tasks/README.md` | Modify | Add this task to the active index |

## Plan

- [ ] **Step 1:** Draft `CONTRIBUTING.md` with sections:
  TL;DR, Before you start, Contribution paths (bug / feature / docs),
  Local development (link), Verification gates, Commit messages,
  Pull Request workflow, Code review, AI agent–assisted contributions,
  Package-specific gotchas, License & CLA.
- [ ] **Step 2:** Trim README's `## Contributing` section to a pointer at
  `CONTRIBUTING.md`, keep the commit-message snippet OR move it fully
  into `CONTRIBUTING.md` (decide while editing — pick whichever avoids
  duplication).
- [ ] **Step 3:** Update `docs/tasks/README.md` active table to include
  this task.
- [ ] **Step 4:** Run `pnpm verify:fast` (markdown-only change, but
  required by repo policy).
- [ ] **Step 5:** Owner review → commit → PR.

## Verification

`pnpm verify:fast` green.

## Notes

- Keep tone and structure aligned with existing repo docs (English,
  concise, table-heavy).
- Do NOT duplicate setup steps already in `README.md` and
  `packages/backend/README.md` — link to them.
- `AGENTS.md` is a symlink to `CLAUDE.md`; reference both names where
  external readers might look.
