# Reduce agent token consumption (#563)

Behavior-preserving efficiency tuning of the autonomous pipeline. Three
independent deliverables; no change to what the pipeline *gates* on or its
fail-closed behavior.

## Deliverable 1 — Path-scope the review lenses (`appliesWhen`)

- [ ] `scripts/agent/lenses/lenses.json`: per-lens `appliesWhen` path globs
      - `correctness` → keep `["**"]` (always applies; guarantees a non-empty
        required-check set, per constraints).
      - `security` → `["packages/**", "scripts/**", ".github/**"]`.
      - `design-fit` → `["packages/**", "scripts/**", "docs/design/**"]`.
      - `test-adequacy` → `["packages/**", "scripts/**"]`.
- [ ] Extend `review-panel.test.mjs` with cases for the new globs (docs-only
      diff skips security/test-adequacy, correctness always applies).

## Deliverable 2 — Tighter fixer prompts → fewer fix rounds

- [ ] `agent-review-panel.yml` "Gather failing lens findings": also parse each
      lens check's `output.text` JSON (file/summary/evidence) into a per-file
      checklist output.
- [ ] Front-load the checklist + read-files-first / one-pass / verify-once /
      stay-in-scope instructions in the fix prompt. Keep existing rules
      (append commit, no force-push, trailer, no merge, reply in thread).
- [ ] `agent-iterate-ci.yml` fix prompt: same read-first / one-pass /
      verify-once / stay-in-scope framing.
- [ ] No change to bounded-loop guards, round cap, or paging.

## Deliverable 3 — Focus the implement agent's exploration

- [ ] `agent-implement.yml` kickoff prompt: read Acceptance criteria up front;
      targeted `Grep` before broad exploration; prefer targeted `Read`; do not
      re-read files; start from issue-named files/areas. Keep the "follow
      CLAUDE.md / CONTRIBUTING.md" instruction.

## Constraints (do NOT weaken)

- `correctness` stays `["**"]` + `samples: 2`.
- Fail-closed behavior, round cap + paging, trust model untouched.
- Prompts never instruct skip-findings / force-push / merge.

## Acceptance / verification

- Existing `review-panel.test.mjs` stays green; new glob cases added.
- Both YAML workflows still parse; `agent:tests` lane stays green.
