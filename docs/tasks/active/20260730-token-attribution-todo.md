# Per-lens / detection-vs-verifier token attribution

The review panel is expensive enough that two runs can exhaust a session limit,
but the logs could not say *where* the tokens went: `review-execution.json` was a
flat, un-tagged list of SDK result messages, and the effort summary collapsed it
to one aggregate. So "which lens?" and "is it the verifier?" were unanswerable
from the ledger.

## The change

- [x] `ask.mjs`: `askStructured` takes an optional `logMeta` and stamps it onto the
      logged result message (shallow copy — the SDK message is not mutated), so
      every call carries `{ lens, role }`.
- [x] `review-panel.mjs`: `runLens` tags `role: "detection"`; `verifyFinding` takes
      a `lensId` and tags `role: "verifier"` — both verifier call sites (fresh/rep +
      fold re-verify, and the prior-round re-check) pass `lensId`.
- [x] `metrics.mjs`: `attributionBreakdown(messages)` → `{ lens: { detection|verifier|other:
      {cost,weighted,tokens,turns,calls} } }`; `aggregateAttribution` sums it across
      rounds; `cmdRecord` attaches it to the review record; `cmdSummarize` aggregates
      and `renderSummary` renders a per-lens cost · weighted-tokens table plus a
      detection-vs-verifier headline.
- [x] Tests for `attributionBreakdown`, `aggregateAttribution`, and the rendered table.
- [x] Design-doc note in `harness-engineering.md`.

## Safe by construction

- **No workflow change.** The attribution rides inside `review-execution.json`, which
  `metrics.mjs record --kind review` already reads on both the autonomous and
  on-demand paths.
- **Backward compatible.** A message without attribution → `unattributed`/`other`;
  a round with none → no table at all (pre-instrumentation PRs render as before).
- **Measurement only** — gates nothing, and `metrics.mjs` stays fail-safe (exits 0).

## Follow-up once the data lands

The point of this is to *measure*, not yet to cut. Once a few real rounds carry
attribution, the likely levers (from the structural analysis) are: `samples` 2→1 on
the cheaper lenses, a lower absence-verifier `maxTurns` (20 is high), or a
per-round cap on verifier calls. Decide those from the table, not from a guess.
