# Lessons: panel feedback corpus

## A plan's calibration data expires; its reasoning does not

The plan specified `classifyCodeRabbitComment` around "Potential issue" / "Refactor
suggestion" / "Nitpick". Those are CodeRabbit's **upstream** labels. This repository
runs the CHILL profile, which emits a three-field header
(`_🎯 Functional Correctness_ | _🟠 Major_ | _⚡ Quick win_`) and has done since at
least #525.

Implementing the plan literally would have produced a classifier that matched zero
comments — and the failure would have been **silent and self-confirming**: an empty
corpus reads exactly like "the panel has no misses", which is the conclusion the
whole PR exists to challenge. A component whose failure mode is "reports good news"
has to be calibrated against the real data before it is written, not after it looks
wrong.

The plan's *reasoning* survived intact (keep substantive findings, drop nitpicks and
auto-summaries); only the strings were stale. Checking which is which took one
`gh api` call across seven PRs.

**When a spec names strings an external system produces, verify them against the
system before writing the matcher — especially when a non-match looks like success.**

## Reuse the classifier, not the glob list

The plan's `interestingFiles` was a hand-written drop-list: `docs/**`, `*.md`,
`.github/**`. Written as specified it would have been the **third** copy of a
path-classification table in `scripts/agent/`, and the second copy is how the first
one rots.

`classifyFile` (#582) already answers a strictly better version of the question, so
"interesting" became "the classes the panel treats as reviewable code" —
`code` + `code-adjacent`. Now a future reclassification moves the harvester
automatically, and the two can never disagree about what code is.

It also forced a distinction the glob list hid: `policy` (`.github/**`,
`scripts/agent/lenses/*.md`) is excluded on purpose. A human editing those after
handoff is changing **the reviewer**, which is a different and often more
interesting event than the reviewer missing a bug. One list cannot hold both
populations without corrupting the number the corpus exists to produce.

**A hand-written list in a spec is a hint about the question, not the answer. Check
whether the codebase already computes it.**

## Boolean flags must be declared, and inference fails in *both* directions

`--append` silently did nothing. The shared `parseArgs` does
`a[flag] = argv[i + 1]`, so a value-less flag at the end of argv became `undefined`,
`if (!args.append)` took the print-only branch, and the CLI **exited 0 reporting
success**. The one write path in the module was unreachable and said so in the
affirmative.

The tempting fix is inference: "treat `--x` as boolean when the next token also
starts with `--`". That is what most hand-rolled parsers do and it is wrong twice
over — a value-less flag at the *end* of argv still reads as `undefined`, and a flag
whose legitimate value begins with `--` gets swallowed. Worse here, `review-panel.mjs`
deliberately passes possibly-**empty** `--since-sha`/`--review-mode`, and any
inference rule has to keep treating `""` as a value rather than a flag.

So `booleans` is an opt-in list the caller declares. Callers that pass nothing are
bit-for-bit unaffected, which matters because this parser is on the path that
narrows the reviewed diff.

**A flag is boolean because the CLI says so. Inferring it from the next token
encodes a guess in the one place a wrong guess is invisible.**

## Two failing tests were worth more than the feature

Three tests failed on their first run, and two of them were real defects I would not
have found by reading:

- `candidateId` used a `typeof v === "string"` coercion. GitHub returns comment ids
  as **numbers**, so every CodeRabbit candidate on a PR got the identical id
  (`coderabbit:548:`) — and `dedupeById` would then have collapsed them to one,
  silently discarding every finding after the first. A corpus that quietly keeps one
  record per PR would still look plausible.
- `parseJsonl` accepted a line of `7`. It is valid JSON and not a record, and
  keeping it puts a number in the corpus for every consumer to defend against.
  Counting it as *unreadable* instead makes it visible and makes `--append` refuse.

Both bugs live in the boring plumbing, both fail toward "smaller corpus, no
complaint", and neither would have shown up in an end-to-end run that happened to
have one CodeRabbit comment.

## The two signatures corroborated each other, which is the real validation

The two seed records were hand-built from evidence: CodeRabbit's `EditorAPI.paste()`
finding, and the `test-adequacy` flip. Then the harvester ran over #548 from a
completely independent signal — human commits after handoff — and proposed:

- *"Guard read-only mutations at the EditorAPI boundary"* → the fix for seed 1
- *"Add real-payload paste test + cut/select-all/table-menu coverage"* → the fix for seed 2

Two signatures that share no input agreeing on the same two defects is much stronger
evidence that the harvester works than any assertion about its internals. The third
candidate ("restore test shims, add copy coverage") is probably *not* a panel miss —
which is the honest signal-to-noise ratio, and the reason `verifiedBy` exists.

**When you build a detector, look for a second, independent way to detect the same
thing. Agreement between two unrelated signals is worth more than either one's
test suite.**

## The strongest argument against `samples: 1` came out of the seed data

The `test-adequacy` seed is proven by construction, not by judgement:

| sha | conclusion | blocking |
|---|---|---|
| `ab952c9` | success | 0 major |
| `ffeb1d2` | failure | 1 major |

The only difference between those two commits is **+16 lines in
`docs/design/sharing.md`**. No test file changed. No source file changed. The same
lens, reading byte-identical test content, found a real and specific defect (a
vacuous paste test that passes whether or not the guard exists) on one run and
missed it on the other.

That is a single-sample false negative, on record, in the dangerous direction — the
`success` came first, so a one-sample panel would have approved and stopped. It is
the first entry in the corpus and it already answers a live question the effort
metrics could not.

## Data files deserve tests as much as code does

`misses.jsonl` has its own test: every line parses, every record carries the exact
field order, a known label and source, a PR number, a summary and an evidence URL,
and no id appears twice.

Without it, a record that silently fails to parse means every measurement is quietly
taken against a smaller corpus than the one people believe they have — and the
measurement still returns a confident number. An eval set is load-bearing
infrastructure; treating it as "just data" is how it drifts.
