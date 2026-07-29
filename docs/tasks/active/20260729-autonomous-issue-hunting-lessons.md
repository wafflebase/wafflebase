# Autonomous Issue Hunting (Phase 26) — Lessons

Design doc: [harness-engineering.md](../../design/harness-engineering.md) → Phase 26

Every lesson here was learned from a **live run**, not from a test. The unit suite
was green at 203 tests while six of these bugs were live. They are all bugs at the
seam between real model output and a trusted gate, which is exactly the seam a unit
test with hand-written fixtures cannot reach.

## 1. Agreement between samples is an OVERLAP question, not an identity question

Three successive identity schemes each returned **zero agreements** on live data:

| Scheme | Result | Why it failed |
|---|---|---|
| hash(scrubbed argv) | 9 candidates → 0 agreed | Two samples reach the same defect by different probes: `bogus-command` and `--nonexistent-flag` both demonstrate that commander errors bypass the JSON envelope |
| hash(`located[0]` + `docCitation`) | 7 → 0 | `located[0]` depends on citation ORDER (`cli.md:373` vs `cli.md:82` for the same defect), and `docCitation` is OPTIONAL — one sample supplied it, the other omitted it |
| overlap on in-scope `file:line` | 14 → 4 agreed | ✅ |

Two samples describing one defect cite *overlapping but not identical* evidence in
*arbitrary order*. No hash can match that. `sameDefect` tests set intersection
instead.

**Line-level, not file-level.** `formatter.ts` genuinely holds two distinct defects
(exit code at `:39`/`:46`, envelope at `:43`); file-level matching collapses them and
hides one. `rounds.mjs` already makes this shape of judgement for stall detection —
an overlap measure gated on file, not a hash comparison. Reach for that precedent
sooner.

## 2. `error_max_turns` is not an API error, and calling it one costs findings

A verifier that exhausted its turn budget returned:

```
subtype="error_max_turns"  terminal_reason="max_turns"  num_turns=9
api_error_status=undefined  result=""
```

`classifyResult` only checked `is_error || api_error_status || terminal_reason ===
"api_error"`, so this landed in the api-error branch with an empty detail rendered
as `"unknown"` and marked **retryable**. Two already-reproduced, cross-sample-agreed
findings were lost, and the log blamed the network for a configuration problem. The
`withRetry` added in response would have burned 3× the cost to fail identically.

Deterministic ceilings (`error_max_turns`, `error_max_budget_usd`,
`error_max_structured_output_retries`, `terminal_reason: "max_turns"`) are now
recognised **before** the api-error branch and are non-retryable, with the subtype
and turn count in the detail.

**This was in the review panel's own report on the Step 0 PR, and it was deferred as
"pre-existing".** Deferring it cost two findings a few hours later. A reviewer
finding you cannot disprove is not the same as a finding that does not matter.

## 3. The verifier turn ceiling was less than half what the job needs

`VERIFIER_MAX_TURNS = 8`, inherited from the review panel. Successful verifiers in
the same run used **14–18 turns**, because a verifier must re-establish the facts
itself with Read/Grep/Glob rather than trust the candidate's citations — that is the
entire job. Now a charter field, default 20.

Unexplained and worth chasing if it recurs: failures tripped `max_turns` at
`num_turns: 9` while successes recorded 14–18 under the same nominal ceiling, so
`num_turns` and whatever `maxTurns` counts are not the same quantity.

## 4. A run that produces no diagnosable evidence is a wasted run

Run 1 cost **$2.80** and reported `9 proposed → 0 agreed` with an **empty drop
table** — indistinguishable from "the explorer found nothing". The proposals were
never persisted, so diagnosis required paying again.

Two fixes, both cheap and both mandatory before spending money on a model:

- `intersectSamples` returns `{kept, dropped}` with a reason per candidate naming the
  actual agreement count.
- Each charter writes `explore-raw.json` (redacted) **before** any filtering.

The return was immediate: the third agreement scheme was validated **offline against
run 2's archived proposals, for free**, instead of costing another $2.80.

Corollary: `sessionLog` was collected and threaded through every SDK call, then
discarded — so the run reported what it *found* and nothing about what it *spent*.
Cost has to be measurable, not estimated, or "should this run nightly?" is
unanswerable.

## 5. The ledger must record judgements, never infrastructure failures

Run 3 dropped two findings to `error_max_turns` and then wrote both to the
seen-ledger. `isNovel` would have skipped exactly the findings the retry and ceiling
fixes existed to recover — they would never have reached a verifier again.

The gate is right to drop an unjudged candidate (no evidence cannot become a
report), but the ledger is a record of *judgements*. Writing an infra failure into it
converts a transient outage into a blind spot lasting until the code in scope
changes. Detected structurally (`verdicts.some(v => !v)`), not by matching the
drop-reason string. Same distinction `review-panel.mjs` draws when it refuses to
count an `infraError` round toward `MAX_REVIEW_ROUNDS`.

## 6. Changing a key algorithm silently voids the ledger

Between runs 3 and 4 `defectKey` changed. Every stored entry stopped matching, so a
defect run 3 had **reported and recorded** came back as novel and was re-verified.
The failure is invisible: the file is present, parses cleanly, and is simply full of
keys that can no longer match. Entries now carry `LEDGER_KEY_VERSION`;
`parseSeenLedger` reports `staleKeys` separately from `parseErrors` (stale is not
corrupt) and the run warns that suppression is not in effect.

## 7. A depth-anchored markdown heading match fails silently

`awk '/^## Non-Goals/'` produced a **198-token** deferrals digest because
`docs/design/cli.md` uses `###`. The real non-goals — device flow, token encryption,
block-level writes, DOCX image upload — never reached the model, and those are
precisely the things a contract hunter files as violations. An extractor that quietly
finds nothing is worse than one that errors, because a thin digest reads as "this doc
has no non-goals". `extractNonGoals` is depth-agnostic, and an integration test reads
the *shipped* doc and asserts those four phrases survive.

Same class of bug in the tests themselves: `/never a shell string/` failed against a
hard-wrapped rubric where the phrase straddled a newline. Multi-word assertions
against wrapped markdown need `\s+`, or they silently depend on where the author
wrapped.

## 8. `find` returning a falsy element defeats `if (found)`

`verdicts.find(v => !v || v.verdict !== "confirmed")` returns the `null` it matched,
so `if (refuted)` is false and the next line dereferences it. Use `findIndex` when
the collection can legitimately contain falsy members.

## 9. Position-anchored command matching is defeated by flag values

`assertSafeArgv` filtered `-`-prefixed tokens and matched the hard-deny list from
position 0. But a flag's *value* survives that filter, so
`--format json api-keys revoke x` left `words[0] === "json"` and slipped a
credential-revoking command past the guard. Matching is now
contiguous-subsequence-anywhere, which over-refuses (a document titled `logout`) —
the correct direction for a safety check, where over-refusing costs one skipped probe
and under-refusing revokes a credential.

## 10. Precision is bought with recall, and the price is visible

The same `docs import --replace --dry-run` defect was **reported in one run and
refuted in the next**. Hand-verification sided with the report: the confirmation gate
at `import.ts:119` genuinely precedes `dryRun` at `:149`, `cli.md:714` genuinely says
`--yes` is ignored, and `notes/`+`slides/` share the ordering.

So unanimity across verifiers does its job — it errs toward dropping — but a real
finding can die to one dissenting vote, and verifiers are not stable run to run. This
is the deliberate trade, not a bug. It is also the argument for keeping filing behind
a human for as long as possible.

## 11. Interactive-only shell config does not reach a tool shell

`CLAUDE_CODE_OAUTH_TOKEN` exported in `~/.zshrc` works in the developer's terminal
and is invisible to a non-interactive tool shell (`.zshrc` is interactive-only;
`.zprofile` had no copy). The fix that keeps the value out of both shell history and
the agent transcript: a mode-600 file outside the repo, sourced per command. Also
found two duplicate `export` lines, where the later silently wins — a stale token
that "is set" but may not authenticate.

## 12. Measured cost, for planning

| | Estimated | Measured |
|---|---|---|
| Per explore session | ~$1.00 | **~$1.40** |
| `contract`, `samples: 2` | $2.00 | **$2.80** |
| `contract`, `samples: 3` + verifiers | ~$5.50–6.50 | **$6.17** |

Dominated by **3.1M cache-read tokens** billed at 0.1× — without prompt caching the
same run would be roughly an order of magnitude more. `metrics.mjs`'s existing
`TOKEN_WEIGHTS` (`cacheRead: 0.1`) already models this correctly.
