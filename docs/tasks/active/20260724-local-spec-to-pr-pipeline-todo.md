# Local Spec → PR pipeline (Claude Code CLI front door)

Add a second front door to the autonomous pipeline: a developer authors a spec
locally and the Claude Code CLI drives spec → task → implement → local review →
`verify:self` → draft PR. Because the back half (`agent-iterate-ci.yml` +
`agent-review-panel.yml`) is triggered purely by CI `workflow_run` on same-repo
`agent/*` branches — not by issues — a locally-produced `agent/*` draft PR is
picked up by the existing CI-fix loop + review panel + ready-gate identically to
an issue-originated one. Only the local front half is new; the back half is reused
unchanged.

Design: `docs/design/harness-engineering.md` (Phase 25: "Local Spec→PR front half").

## Principles

- Reuse, don't reinvent: the local flow emits the byte-identical artifact the
  cloud front half already produces, so the proven back half needs no change.
- Single source of truth for the disclosure gate: `disclosure.mjs` is imported by
  both `mark-ready.mjs` (the gate) and `spec-to-pr.mjs` (the local self-check).
- Local review is a convenience pre-filter; the cloud review panel on green CI
  stays authoritative.
- Single-writer: the local session owns the branch only until the draft PR exists;
  after handoff the cloud loops own it (rebase-before-handoff; loud notice; end).

## Tasks

- [x] `scripts/agent/disclosure.mjs` — shared `disclosesAiAuthorship` +
      `hasDisclosureTrailer`; refactor `mark-ready.mjs` to import it.
- [x] `scripts/agent/spec-to-pr.mjs` — `handoff` (fail-closed: slug, branch,
      commits+trailer, slug-uniqueness, body self-check, push, draft PR,
      `set-state awaiting-ci`, ownership notice) + `review` (token-gated local panel).
- [x] `scripts/agent/spec-to-pr.test.mjs` — slug validation, `renderPrBody`,
      disclosure predicate + trailer helpers (auto-globbed by the `agent:tests` lane).
- [x] `.claude/commands/spec-to-pr.md` — the slash-command playbook (8 steps +
      required human gate + local verify + token-gated review + handoff).
- [x] `docs/design/harness-engineering.md` — Phase 25 subsection.
- [ ] End-to-end validation (maintainer, armed, base-repo push): trivial change →
      `/spec-to-pr` → draft PR's `pull_request` runs CI → confirm
      `agent-review-panel`/`agent-iterate-ci` fire via `workflow_run` for the
      `agent/` branch → panel posts checks → mark-ready promotes to ready. Eyeball
      that `workflow_run.head_branch` resolves to `agent/<slug>` on the first run.

## Prerequisites / flags

- `CLAUDE_CODE_OAUTH_TOKEN` exported locally for the review step (else it skips);
  `cd scripts/agent && npm ci` for the SDK.
- Local `gh` auth + **push rights to the base repo** (fork pushes are rejected by
  the back half — this front door is base-repo-write tier, like arming).
- `AGENT_PIPELINE_ENABLED == 'true'` and `main` branch-protected for the back half.

## Sequencing

Stacked on the single-state-label PR (#538): `spec-to-pr.mjs` shells out to
`set-state.mjs` and shares the refactored `mark-ready.mjs`. Merge after #538.
