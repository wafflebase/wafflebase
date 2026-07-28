# Lessons: coverage-first rubrics

## A prompt has a last line, and the last line wins

The plan for this change listed four files: the four lens rubrics. Rewriting
those four would have produced a green PR, a good diff, and roughly no effect —
because `runLens` appends its own closing instruction *after* the rubric and the
diff, and that instruction said the opposite of the new rubrics.

Nothing in the rubric files points at it. You find it by asking "what does the
model actually receive, in order?" rather than "which files does this change
name?" For prompt work those are different questions, and only the first one is
about behaviour.

Generalisation worth keeping: when a prompt is **assembled** from a template plus
a data file, changing the data file is half the job. Print the assembled string
and read it top to bottom, the way the model does.

## One field cannot carry two meanings

The rubrics said *"when unsure, downgrade"* because there was nowhere else for
doubt to go — the schema had `severity` and nothing else. That instruction was a
reasonable local response to a schema gap, and it quietly destroyed the severity
scale: nineteen PRs, zero `critical` findings.

The fix is not better wording. It is a second field. Once `confidence` exists,
*"never downgrade severity to express doubt"* becomes actionable advice instead
of a demand with no alternative.

Worth checking elsewhere in this pipeline for the same shape: an instruction that
sounds like a policy but is really a workaround for a missing field.

## Coerce what gates, report what measures

`normalizeSeverity` maps unknown → `major`. `confidenceCounts` maps unknown →
`unknown`. The inconsistency is the point, and it took a moment to see:

- **Severity gates the merge**, so an unparseable value must resolve to something
  safe. Coercion is correct.
- **Confidence gates nothing**, so it is purely a measurement. Coercing a missing
  value into `high` would hide precisely the failure this metric exists to
  detect — a lens that stopped emitting confidence and went back to expressing
  doubt through severity.

"Fail safe" and "report honestly" pull in opposite directions here, and which one
applies depends on whether the value is on the gate path.

## Removing a filter is only safe if a better one replaced it

The clamp was doing real work: it kept noise off the gate. Deleting it in
isolation would have flooded the fix loop with low-quality findings and made the
pipeline worse, which is presumably why it was written in the first place.

What made removal safe was sequencing — the previous PR made the verifier
independent and forced it to ground refutations, so there is now a filter that
checks the repository instead of one that asks the reporter to self-censor. The
ordering was load-bearing, not incidental. If these two had shipped in the other
order there would have been a window with no effective filter at all.

## Mutation-test a guard whose subject is prose

The new test reads the four rubric files and asserts no clamp phrasing survives.
That kind of test is easy to write in a form that can never fail — a typo'd
regex, a wrong path, an `assert.ok(true)` in disguise — and nothing about a green
suite would reveal it.

Re-adding `When unsure, downgrade.` to `correctness.md` and watching the test go
red took thirty seconds and is the only evidence the guard works. Do it for any
test whose subject is text rather than behaviour.
