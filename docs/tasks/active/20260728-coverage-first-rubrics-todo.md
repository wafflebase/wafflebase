# Coverage-first rubrics: separate severity from confidence

Invert the four lens rubrics from "only report what you are sure about" to
"report everything, let the verifier filter", and give the lenses a `confidence`
field so doubt has somewhere to go other than the severity scale.

## Motivation

The audit's sharpest single number: **zero `critical` findings across nineteen
agent PRs.** Not one. The scale has a top rung nothing ever reaches.

The cause is in the rubrics. Every one of the four closed with a conservatism
clamp — *"When unsure, downgrade"*, *"Use critical/major ONLY with concrete,
cited evidence"*, *"When unsure whether something is concrete or taste, mark it
minor"* — and the schema gave a lens exactly one field to express doubt with:
`severity`. So doubt and impact were the same number, and every uncertain
`critical` came back as a `minor`.

This is a documented failure mode, not a subtle one. Anthropic's guidance for
Opus 4.7+ names it directly: severity filters in the prompt make the model
**investigate just as thoroughly and then decline to report**. Precision rises,
measured recall falls, and the work was done either way.

The panel already had two precision stages (this clamp, then the verifier's
refute pass) and no recall stage at all. The verifier is now grounded and
independent (previous PR), so it is a much better filter than a prompt
instruction — which is what makes removing the clamp safe rather than reckless.

## Scope

- [x] All four rubrics
      (`scripts/agent/lenses/{correctness,security,design-fit,test-adequacy}.md`)
      — replace the closing clamp with a **Coverage first** section, a
      **Severity — impact, not certainty** section, and a **Confidence —
      certainty, separately** section.
- [x] `review-panel.mjs` `FINDING` — add `confidence: high|medium|low`,
      **required** alongside `severity` and `summary`.
- [x] `review-panel.mjs` `runLens` — rewrite the closing instruction (see below).
- [x] New pure export `confidenceCounts(findings)` →
      `{high, medium, low, unknown}`.
- [x] `lensStats.raisedConfidence`, aggregated in `metrics.mjs` and rendered in
      the PR summary comment.

## The clamp that was NOT in the rubrics

`runLens` appends this after the rubric and the diff:

> Return ONLY the structured verdict. Use critical/major severity ONLY for a
> concrete, defensible violation with cited evidence; taste → minor/nit.

It is the **last thing the lens reads**, so it wins ties against everything above
it. Rewriting only the four `.md` files would have left every lens with a
coverage-first rubric and a certainty clamp immediately after it, and the clamp
would plausibly have won. The measured result would have been "the rubric
inversion didn't work".

Both now say the same thing. The block is an exported constant
(`LENS_CLOSING_INSTRUCTION`) so the anti-clamp guard can check **both halves of
the prompt with one list of forbidden phrasings** — guarding only the `.md` files
would leave the place the clamp actually lived unguarded. The guard also asserts
`runLens` still appends it, since an exported constant nothing uses is a guard
over dead text.

The one part worth keeping was *"taste → minor/nit"*. That is a judgement about a
finding's **kind**, not about certainty, so it survives in both places — now
stated explicitly as such, since the distinction is exactly what the rest of the
change turns on.

## Gating is deliberately unchanged

`BLOCKING` stays `{critical, major}` on **severity only**. A `low`-confidence
`critical` blocks exactly like a `high`-confidence one.

Gating on confidence is the obvious next thought and it is wrong: it would
rebuild the clamp inside the trusted script, one layer down, where it would be
harder to see. Filtering is the verifier's job, and the verifier now has to
ground its refutations.

For the same reason, **confidence is not shown to the fix agent.** It already
isn't — `renderSummaryMd`'s `section()` prints only `file` and `summary` — so
this needed no code, but it is a property to preserve deliberately, not by
accident. A fixer that can see "confidence: low" on a blocking finding has been
handed an argument for skipping it.

## Measurement

New row in the PR summary comment:

```
- Confidence of raised (does NOT gate): 4 high, 2 medium, 1 low, 0 unrated
```

`unknown`/unrated is load-bearing. Unlike `normalizeSeverity` (unknown → `major`,
because severity gates and must fail toward blocking), confidence gates nothing,
so coercing a missing value into a real bucket would only hide the thing worth
knowing: a lens that has stopped emitting confidence is back to expressing doubt
through severity.

The two signals to watch after this lands:

1. **`critical` becomes non-zero.** If the count stays at zero, the decoupling
   did not take and the cause is somewhere else.
2. **`medium`/`low` are actually used.** An all-`high` distribution means the
   lens is not using the new axis and the clamp effectively survives.

## Expect more findings, and more rounds

Third PR in a row that pushes recall up and round-count with it — and this is the
largest of the three. More findings raised, more surviving the verifier, more fix
rounds.

The counterweights are already merged: the grounded independent verifier (#573)
filters better than the clamp did, and convergence detection (#570) pages a human
at round 3 instead of burning to `MAX_REVIEW_ROUNDS`.

## Verification

- `agent:tests`: 113 tests green (was 110).
- `pnpm verify:self` green.
- Both guards are **mutation-tested** — a guard that cannot fail is not a guard:
  - re-adding `When unsure, downgrade.` to `correctness.md` fails the rubric
    guard;
  - restoring the old clamp inside `LENS_CLOSING_INSTRUCTION` fails the wrapper
    guard;
  - and detaching the constant from `runLens` fails the "it must still reach the
    prompt" assertion.
- The rubric guard also asserts the set it checks equals the manifest's lens ids,
  so a fifth lens cannot ship with a clamp unnoticed.

## Two defects review caught after the first push

- **`confidenceCounts` used `c in out`**, which walks the prototype chain. A
  finding with `confidence: "constructor"` matched, incremented an inherited
  property, and left an extra `constructor` key on the returned counts — *and*
  was not counted under `unknown`. Corrupted shape plus a lost count, from one
  untrusted string. Now an allowlist `Set` derived from the schema enum.
- **The wrapper had no guard.** The rubric test covered the four `.md` files but
  not `runLens`'s closing block — the one place the clamp actually lived. Fixed
  by exporting the block and running the same checks over it.

What this does not verify: **whether the lenses actually change behaviour.** No
test here exercises a model. The real signal is the two counts above on the next
few autonomous PRs, plus the offline three-run agreement comparison in the plan's
verification section.
