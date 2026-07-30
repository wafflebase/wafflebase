# Absence claims: verify "there is no X" by hunting a counterexample

Split findings into `presence` and `absence` claims and verify them in opposite
directions, because refuting the second means FINDING something rather than
failing to find it.

## The problem, from #578

The disposition comment's second bucket was findings that simply "don't hold".
The clearest was **"No CI workflow runs `scripts/agent/*.test.mjs`"** — false.
`ci.yml:41` runs `pnpm verify:self`, whose first lane is `agent:tests`
(`verify-self.mjs:16`). Those tests gate every PR.

The verifier confirmed it anyway, and the reason is structural rather than a
prompt weakness. To refute *"there is no X"* it must **find an X**: chase
`ci.yml` → `pnpm verify:self` → `verify-self.mjs` → the `agent:tests` lane, then
read each to confirm. That is three hops plus reads against a ceiling of 8 turns.
It ran out, could not reach a grounded refutation, and the bias-to-keep rule did
the rest.

The asymmetry is the whole problem:

|  | refuted by | cost |
|---|---|---|
| presence — "this code is wrong" | showing the code is not as described | a lookup at a named location |
| absence — "there is no X" | finding one instance of X | a search across the repository |

**Failing to find X is indistinguishable from X not existing.** So the same
bias-to-keep rule that protects real findings rubber-stamps false absence claims.

## What this PR does

- [x] `FINDING` gains `claimType` (`presence`/`absence`, **required** so a lens
      must decide rather than default by omission) and `searchedFor` — what the
      lens actually searched before concluding something is missing.
- [x] Guidance goes in `LENS_CLOSING_INSTRUCTION`, the shared prompt slot, not
      copied into five rubric files. A test asserts no rubric carries its own copy.
- [x] `verifyFinding` branches its prompt on `claimType`. An absence claim is
      told the job is to find ONE counterexample, that the thing may live under
      another name or be reached indirectly ("two or three hops from where you
      started"), and exactly what the lens already searched — so it looks where
      the lens did **not** rather than repeating a search that came up empty.
- [x] New `counterexample` refutation ground. The existing grounds all describe
      ways a PRESENT thing fails to be a defect, which is the wrong shape.
- [x] `VERIFIER_MAX_TURNS` becomes `{presence: 8, absence: 20}`. Absence claims
      are the minority, so the extra ceiling is bounded in practice.
- [x] New `unresolved` verdict, plus `absenceRaised`/`absenceRefuted`/
      `unresolved` counters through `verifierTally` → `lensStats` →
      `metrics.mjs`, and an *"(verifier could not settle this)"* marker in the
      rendered summary.
- [x] `claimType` persisted into check `output.text`, so round N+1 verifies a
      carried-forward absence claim as an absence claim rather than defaulting it
      to `presence` and giving it the smaller budget.
- [x] `buildVerifierPrompt` extracted and exported so both branches are checked
      by RENDERING, following the precedent `buildLensPrompt` set. 223 tests green.

## `unresolved` does NOT demote — and that is the point

The original plan had `unresolved` route to a non-gating lane. That was rejected
after PR #583's review, which caught the novelty gate demoting an entire
legitimate class of findings.

The same trap is here, and it is bigger. Absence claims are not a noise category:
*"no test covers this"* is **test-adequacy's entire output contract**, *"no
validation on this input"* is much of security, and *"no design doc records this
module"* was a **correct** #578 finding. Routing unsettleable absence claims off
the merge gate would silently disable large parts of three lenses.

So `unresolved` keeps the finding blocking, exactly as `confirmed` does.
`isDroppingVerdict` is untouched and still requires an explicit `refuted`. The
value is honesty and measurement: "I searched and could not disprove this" and "I
checked and it is real" used to be the same word, and collapsing them hid how
often the verifier was guessing.

**The mechanism that actually fixes #578's case is refutation, not demotion.**
The counterexample there is real and findable; with 20 turns, a hunt-shaped
prompt and the lens's `searchedFor` to search around, it should come back
`refuted` on the `counterexample` ground — dropped by the existing rule, with
cited evidence, no new demotion path required.

## What to watch

`absenceRaised` vs `absenceRefuted` vs `unresolved` in the metrics comment.

- High `unresolved`, low `absenceRefuted` → absence claims are riding through
  unchecked. Either the turn ceiling is still too low or the lenses are raising
  claims they have not searched for; `searchedFor` being empty distinguishes them.
- High `absenceRefuted` → the mechanism is working and #578's class is being
  caught at the point it should be.

## Deliberately not in this PR

- **Wrong mechanism, true kernel.** A binary confirmed/refuted verdict has
  nowhere to put "the concern is real but the stated cause is wrong", so such a
  finding rides through at full severity (#578's "Bash/Write stay available").
  Needs a `confirmed-corrected` verdict that may only downgrade.
- **Duplicates.** `dedupeFindings` keys on `file + lowercased summary` and the
  verifier runs per-finding in isolation, so the same bug in different words
  survives twice. Needs a clustering pass over the whole surviving set.
