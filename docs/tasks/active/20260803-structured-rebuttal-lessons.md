# Lessons: structured rebuttal + independent adjudicator

## A narrow projection is a silent channel break

`groupReviewRounds` maps every carried finding down to
`{lens, severity, file, summary}` — a deliberate, sensible narrowing for the job
it was written for (convergence detection needs nothing else). The rebuttal count
travels from the panel to the round guard *through that function*, and it was
being dropped in the middle.

Both halves passed their unit tests. `adjudicateRebuttals` incremented the count;
`exhaustedFindings` fired on a finding carrying one. The break was in the pipe
between them, and the symptom of the break is **the page never fires** — which is
indistinguishable from "no one ever disputed anything". A silent no-op, in the
component whose entire job is to stop a silent deadlock.

It surfaced only because I assembled the real shape end to end: serialize what the
panel writes → run the workflow's own `.map()` → feed it through
`groupReviewRounds` → call the guard's predicate.

**When a value crosses three modules, test the crossing, not the modules.** And be
specific about the failure mode you are hunting: a value that fails to arrive
looks like a value that was never sent.

## Extract inline YAML JavaScript and execute it

The carry-forward field list lives in a `github-script` block, where it cannot be
unit-tested or linted — the exact problem `prior-findings.mjs` was extracted to
fix. Rather than eyeball the change, I pulled the `.map()` expression out of the
YAML with a script and ran it against a finding carrying an adjudication.

That confirmed four things at once in about a minute: the integer survives, the
adjudicator's prose reason is stripped (it would have eaten the 60k budget for
text no consumer reads), folded `mergedFrom` counts survive, and an undisputed
finding carries no key at all.

**If you cannot test it where it lives, lift it somewhere you can and run it.** A
read-through of inline YAML JS is not verification.

## Inject the thing you cannot afford to have wrong

`adjudicateFinding` opens an SDK session, so the interesting paths —
overturn drops, ungrounded upholds, an errored session upholds, the count
increments — were all unreachable from a test. `isOverturningVerdict` was well
covered, but that is the *judgement*; the **plumbing around it** is where a
fail-open would actually hide, because it is the part nobody re-reads.

Adding an injectable `adjudicate` (defaulting to the real one, same shape as `api`
in `gh-checks.mjs`) made all five decisions pinnable, and one of them —
"an ambiguous match opens no session at all" — is a cost property as well as a
safety one.

## Give the untrusted writer a CLI, not a format

The fixer has to emit a record the panel can parse. Asking a model to hand-write
exact JSON inside an HTML comment fails often enough to matter, and the failure
mode is the bad one: an unparseable rebuttal is ignored, so the author never
learns the dispute went nowhere, and the outcome is identical to never having
argued.

`rebuttal.mjs post` makes it mechanical, and `serializeRebuttal` becomes the only
writer — so the format cannot drift from the parser that must read it. The command
even round-trips its own output before posting, because a record this module
cannot read back is a record the panel will ignore.

**When an unreliable party must produce a machine-readable artifact, hand them a
tool, not a schema.**

## The fail direction has to be structural in every place, not argued once

"Persuasion must never be a bypass" is easy to state and easy to leak. It needed
four separate safeguards, each covering a different way an argument could win
without being right:

- unparseable → ignored
- ambiguous match → refused (a rebuttal fitting two findings names neither)
- errored session → upholds
- ungrounded verdict → upholds

The ambiguity one is the least obvious and the most important. Without it, an
author who writes text matching several findings in one file gets them
adjudicated together — one argument, several removals. Refusing ties costs a
legitimate rebuttal nothing (re-word it more specifically) and closes the whole
shape.

## "True" and "exculpatory" are different, and the schema should say so

#564's rebuttal was correct: the App genuinely cannot push
`.github/workflows/**`. The tempting design gives that an overturn ground.

It must not. The finding was *also* correct, and the work still needed doing — by
a human. An overturn ground for inability lets a PR merge with the work declared
impossible, which is strictly worse than the deadlock it replaces. So there is no
such ground; the rebuttal is upheld and reaches a person through the repeat page,
which is where undeliverable-but-correct work belongs.

`out-of-scope` is absent for a neighbouring reason — scope is an argument, not a
fact about the code, and it is the most persuadable ground a model could be
handed.

**Ask what a ground would let through on its worst day, not what it expresses on
its best one.**
