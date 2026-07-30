# Lessons: independent verifier

## A prompt instruction the script doesn't check is not a rule

The old verifier prompt said *"Return refuted+high ONLY if you can state a
concrete, specific reason"*, and `VERIFIER_SCHEMA` had a `reason` field. Neither
did anything: `applyVerifications` dropped on two enum fields and never looked at
`reason`. The constraint existed in the text a model could ignore and nowhere in
the code that acted on the answer.

The fix is not a firmer prompt. It is making the shape the model must produce
carry the evidence, and having trusted code check the shape —
`refutationGround` is a closed enum and `groundedIn` must contain something
shaped like `file.ext:line`, both verified in `isDroppingVerdict`. The model can
still lie about *what* it read, but it can no longer drop a finding while saying
nothing at all.

**The first draft of this PR made the same mistake one level up.** It checked
that `groundedIn` held a non-blank string — so `["looks fine"]` passed as a
citation, which is the identical unevidenced assertion merely wearing a
citation's costume. And it withdrew the `pre-existing` ground *in the prompt*
when the changed-file list wasn't authoritative, while `isDroppingVerdict` knew
nothing about it: a model that ignored the instruction still dropped the finding.
Review caught both. Writing down the principle is not the same as having applied
it — worth re-reading your own diff against your own stated rule.

Worth applying to the other prompt-only contracts in this pipeline: any "only do
X if Y" aimed at a subagent whose output the script consumes is a candidate for
promotion into the schema, and then into a check.

## Independence is about the input, not the model

The obvious reading of "make the verifier independent" is "run it on a different
model". That would not have helped. Both readers were being handed the same diff,
and a diff hunk that reads as a bug to one careful reader reads as a bug to
another — the errors correlate because the *evidence* is shared, not because the
weights are.

Changing the evidence source was also nearly free here: the SDK call already ran
with `cwd: repo` and `Read`/`Grep`/`Glob` allow-listed for the lens subagents.
The diff was being passed *in addition to* tools that could reach the real code.
Deleting one parameter was most of the change.

## Derive the constant from the schema

`REFUTATION_GROUNDS` started as a hand-written `new Set([...])` duplicating the
schema's `enum`. Two copies of one list, one used to instruct the model and one
used to judge its answer: add a ground to the enum and forget the Set, and
`isDroppingVerdict` silently rejects a legal refutation forever — failing safe,
so no test would catch it. It is now
`new Set(VERIFIER_SCHEMA.properties.refutationGround.enum)`.

## Truncation changes what a list means

Capping the changed-file list looked like a pure cost decision. It is not: the
list is what the verifier uses to answer `pre-existing` ("the PR didn't touch
this file"), and under a truncated list an absent path is indistinguishable from
a cut-off one. Left alone, the cap would have converted a cost optimisation into
a fail-open that drops real findings on large PRs — the exact direction
everything else on this path is built to avoid.

Hence `authoritative`: truncated is treated as missing, and the ground is
withdrawn — in the trusted script, not only in the prompt. The general shape —
*bounding an input can change what conclusions it supports* — is worth checking
for wherever a prompt gets a "list of everything".

The same argument extends past truncation, which the first draft missed:
silently filtering a malformed entry also removes a path the verifier cannot see
is gone. `changedFileContext` therefore drops junk from what it *lists* (so the
prompt stays clean) but stops calling the list authoritative. Filtering junk and
carrying on is the reflex; here the filtering itself was the information loss.

## Keep the metric that measures the change you made

`refutedHighConfidence` used to be the drop count. After this change it is an
upper bound on it, so leaving it alone would have left a number in the PR summary
whose label had quietly stopped being true. Adding `dropped` alongside it costs a
few lines and makes the *gap* readable — confident refutations the gate declined
to act on, which is the direct measurement of whether the grounding requirement
is doing anything.

Ledger entries written before the change have no `dropped` field. They coerce to
0, which reads correctly rather than merely safely: under the old rule those
drops were already counted by `refutedHighConfidence`.

## Rendering a prompt beats reading it

The first draft assembled the prompt with `.filter((l) => l !== "")` to drop an
absent evidence line — which also deleted every deliberate blank-line separator,
collapsing the whole prompt into one wall of text. It reads fine as a diff; it is
obvious the moment you print it.

Extracting the function body and executing it against four inputs took a couple
of minutes and caught that plus the "PARTIAL LIST of 0" wording on the empty
case. For prompt-building code, print the output — the assembled string is the
artifact under review, not the array literal.
