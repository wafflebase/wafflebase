# Design Doc Audit — verify docs/design reflects shipped implementation

## Goal

Audit all 100 `docs/design/*.md` documents (excluding README.md index and
template.md) against the current codebase. For each doc, determine whether the
"currently shipped" scope it describes matches what is actually implemented,
and surface drift in either direction.

## Approach

One subagent per doc (Workflow fan-out). Each agent:
1. Reads the design doc.
2. Greps/reads the relevant code to check claims.
3. Returns a structured verdict + discrepancy list.

Then synthesize into a ranked report of docs needing updates.

## Discrepancy types

- `documented-not-implemented` — doc claims shipped, code doesn't have it.
- `implemented-not-documented` — code has it, doc omits / marks as future.
- `roadmap-shipped` — a "deferred/planned/Phase N" item has actually shipped.
- `stale-reference` — wrong file path / renamed symbol / moved module.
- `other`.

## Status

- [x] Enumerate docs (done — 100 files)
- [x] Run per-doc audit workflow (100/100 complete)
- [x] Synthesize ranked report → `20260802-design-doc-audit-findings.md`
- [x] Present findings to user
- [x] Fix the 27 significant-drift docs (workflow `wf_08374543-9be`, all edited)
- [x] Verify the 4 factual-bug corrections + agent-added specifics by hand
- Optional follow-up, **deferred**: 57 minor-drift docs (cosmetic stale
  paths/symbols). Out of scope for this task — see the findings file for the
  per-doc list if it is ever picked up.

## Result (complete — 100/100)

16 accurate, 57 minor-drift, 27 significant-drift. 37 docs carry ≥1 high-sev
finding; 45 of 57 high-sev findings are `roadmap-shipped` (proposal-tense docs
for features that have since shipped). Biggest cluster: `slides/*` (10
significant-drift — the whole package shipped ahead of its docs).
Full per-finding evidence in `20260802-design-doc-audit-findings.md`.
