# Lessons — Local Spec → PR pipeline

## What worked

- The back half was already decoupled from issues (triggers on CI `workflow_run`
  for `agent/*` branches), so the local front door needed **zero** changes to it —
  it just had to emit the same artifact.
- Verified the load-bearing assumptions against the code before building: `ci.yml`
  is `push:[main] + pull_request:[main]` (so opening the draft PR is the CI
  trigger, a bare branch push is not), and the disclosure gate is
  `/autonomous/i && /(claude|ai[- ]assist|ai tools)/i`. The cloud front half
  already relies on the same PR-open→`workflow_run` path, so it's battle-tested.

## Pitfalls / decisions

- `mark-ready.mjs` is a top-to-bottom imperative script with **no exec guard** —
  importing from it would run its CLI. The shared disclosure predicate therefore
  had to live in a new pure module (`disclosure.mjs`), not be exported from
  mark-ready. This is the correct single-source-of-truth (mirrors how mark-ready
  already imports `allRequiredPassed` from `checks.mjs`).
- Chose `agent:awaiting-ci` (not `implementing`) for the post-handoff state: by
  handoff the local implementation is done and CI is pending, so `awaiting-ci` is
  the honest state. The panel/reconcile advance it from there.
- Local review is deliberately non-authoritative and token-gated — it degrades to
  warn-and-skip without `CLAUDE_CODE_OAUTH_TOKEN`, because the cloud panel is the
  real gate and requiring a local token would make the flow brittle.

## Open items

- The single-writer rule (don't push after handoff) is behavioral, not mechanical.
  If it bites in practice, consider a mechanical guard (e.g. the helper switching
  the local checkout back to `main` after handoff).
- End-to-end run still pending (needs an armed pipeline + base-repo push).
