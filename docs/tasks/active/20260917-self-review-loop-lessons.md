# Self-review loop — lessons

## Check the gate before claiming a loop covers a branch

I asserted that the cloud review→fix loop already ran, so a local 3-round loop
would duplicate it. It does not. `agent-review-panel.yml:192-199` admits a PR
only when the branch starts with `agent/` **or** the PR carries
`agent:managed`; every other PR gets CI and nothing else. `gh pr checks` on
three merged human PRs (#1071, #1063, #1057) shows zero `agent-review-*` checks,
and #1061 — a human branch *with* the label — shows all seven.

**Rule:** before saying an automated stage covers some work, read the workflow's
`if:` / gate job and confirm against a real run. A workflow existing in the repo
says nothing about which PRs it admits.

## "Prior findings" and "rebuttals" solve opposite failures

Also mis-stated: I said carrying prior findings forward stops a later round from
re-raising what round 1 already flagged. It does the reverse — it carries
**unfixed** findings forward so a round that happens to miss one cannot clear it.
The re-raise of a finding you deliberately *declined* is what `--rebuttals`
addresses, via an adjudicator subagent.

**Rule:** name the failure mode a flag prevents before recommending it. Two
round-threading inputs that sound similar had opposite fail directions here.

## A workflow step that names a tool the actor cannot run is not a workflow step

The first draft of both the command and `CLAUDE.md` put `/code-review` and
`/simplify` in the round rotation. Neither can be invoked by an agent — they are
user-invoked and billed — so an agent following the loop would have reached round
2, found the door locked, and either skipped the round silently or substituted
its own read of its own diff and called that a review.

**Rule:** when writing a process doc, check who the actor is and whether that
actor can actually perform each step. Name the invocable tool for the agent path
and mark the rest as "ask the human", rather than listing them as
interchangeable.

## Self-review in the same context is the weakest round available

This branch's round 1 ran without `CLAUDE_CODE_OAUTH_TOKEN`, so the six-lens
panel skipped and the review was my own read of my own diff — the exact failure
mode the panel's verifier exists to avoid (a reviewer that shares the author's
context inherits the author's misreadings). It still found three real defects,
which says something about the first draft, not about the method.

**Rule:** say which reviewer actually ran. "Reviewed" without naming the reviewer
lets a skipped panel and a real one read identically in a task file.

## Verification runs are part of the system under test

Two `--dry-run` probes, used to check the guards from round 1, each created a
round directory and wrote a diff into it. `nextRound` counted them, so a branch
that had reviewed twice ran its next round as **round 5** and tripped the
three-round bound. The probe changed the state it was probing.

**Rule:** before using a command to verify itself, check what the verification
path writes. A read-only-looking flag that creates a directory is not read-only,
and the damage shows up as a confusing number several steps later.

## An infra failure must not be able to look like a clean round

Round 3's first attempt hit HTTP 429 and all six lenses failed with no findings.
The output said `no finding recorded (the lens may not have run)` for each —
wording added one round earlier for exactly this shape. Without it the run reads
as "six lenses blocked, zero findings", which is indistinguishable from noise a
developer would override.

**Rule:** when a report can be empty for two opposite reasons — nothing was
found, or nothing ran — the empty case has to say which. Silence defaults to the
optimistic reading.

## A fixture the producer would never emit hides the bug it was written for

The on-disk carry-forward test used `{ findings: [...] }`. The real producer
writes `{ valid, conclusion, findings }`, and the bug round 2 found was that a
`{ valid: false }` or `{ conclusion: "skipped" }` file was being counted as a
verdict. The fixture could not have caught it because it did not have the fields
the bug was about. `prior-findings.test.mjs` warns about this at the top of the
file; I wrote the fixture anyway.

**Rule:** build fixtures from the producer's actual output shape — ideally from
the producer — not from the fields the consumer happens to read.

## A prose claim about another module is the gap the lenses do not cover

For three rounds this command printed `finding-key.mjs`'s key while its own
docblock — and `/self-review.md` — called it "the identifier a rebuttal is
addressed to". A rebuttal record's key is `rebuttal.mjs`'s, a different string
for the same finding. Six lenses over four rounds did not catch it: each one
reads the diff, and the diff is self-consistent. The contradiction only exists
against a file the diff does not touch.

**Rule:** when a comment asserts how *another* module behaves, open that module
and check. The assertion is load-bearing documentation, and nothing in the
review path verifies it.

## Fixing the same area four times is the signal, not the finding count

Rounds went 7 → 5 → 5 → 7 findings, which reads as "not converging". The more
useful reading is narrower: the *directory guard* was wrong in four consecutive
shapes, each fix introducing the next hole, while docs / correctness / design-fit
went quiet and stayed quiet. Aggregate counts hid that one subsystem was churning
and the rest had settled.

**Rule:** track which area each round's findings land in, not just how many there
are. Repeated findings in one area mean that area needs a different approach (or
a different reviewer), not another round.
