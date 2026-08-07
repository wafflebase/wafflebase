# Structured rebuttal + independent adjudicator

PR 10 of the review-panel audit series. Closes the loop the fixer prompt has been
apologising for since #564.

## The problem

The fixer prompt says: *"If you believe a finding is wrong, do NOT change code for
it; reply in the PR thread with your reasoning."* Nothing consumed that reply. The
prompt was honest about it — *"A reply does NOT resolve the finding — nothing
consumes it, the next round will raise it again, and only an independent
adjudication or a human can clear it."*

On **#564** the fixer wrote a correct, evidenced rebuttal (the App cannot push
`.github/workflows/**`, with the literal push error) at 06:46. The 07:05 panel
never saw a word of it and re-raised the same finding, twice more.

## The change

- [x] `scripts/agent/rebuttal.mjs` — the record, the matcher, the overturn rule,
      the bound, and a two-verb CLI (`read` for the trusted panel, `post` for the
      author-side fixer).
- [x] `adjudicateRebuttals` in `review-panel.mjs`, running over **gating findings
      only** — a demoted finding blocks nothing, so arguing about it spends a
      session to change no outcome.
- [x] `--rebuttals <file>`; absent → `[]` → short-circuits before any session
      opens. An un-wired panel is the panel that existed before this.
- [x] Both panel workflows read rebuttals; the gating one also carries
      `adjudication.upheld` in `output.text` and rewrites the fixer prompt.
- [x] `review-round-guard.mjs` pages on a twice-upheld dispute, checked **before**
      convergence — the more specific reason wins, as with the infra branch.
- [x] `pnpm verify:self` green (11/11); 507 agent tests (478 on `main`).

## Persuasion must never be a bypass

Four independent fail-safes, so it is structural rather than hoped-for:

| where | on doubt | why |
|---|---|---|
| `parseRebuttalComment` | `null` | a half-understood rebuttal is worse than none — the only thing it can do is remove a finding |
| `matchRebuttal` | **refuses a tie** | text fitting two findings equally well is the shape of one argument clearing several; the safe reading is that it names neither |
| an errored adjudicator session | upholds | an error argues nothing |
| `isOverturningVerdict` | upholds | needs `overturned` + `high` + an enumerated ground + a `file.ext:line` actually read |

**A rebuttal can only ever lose.**

## Undeliverable is not wrong

There is no overturn ground for *"I cannot make this change"*, and that is the
#564 case exactly: the claim was **true** and the finding was still correct and
still needed doing — by a human. Such a rebuttal is upheld, re-raised, disputed
again, and pages at two. A ground for inability would let a PR merge with the work
declared impossible. `out-of-scope` and `pre-existing` are absent for related
reasons: scope is an argument rather than a fact about the code, and provenance is
the novelty gate's job (#583), answered with git.

## The bound

`MAX_REBUTTAL_ROUNDS = 2`. The count rides on the finding through the check run's
`output.text` — the **unforgeable** channel — never through the author's own
comments. Paging is the safe direction, so a forged count costs only an
unnecessary human look; but a bound the disputing party can move is not a bound.

It also fires on a shape the plan did not name: overturned in round 1, re-raised
in round 2 (lenses are stateless), disputed again. Both shapes mean the loop
cannot settle it alone, so the counter deliberately does not distinguish them.

## Verification

- [x] 30 tests in `rebuttal.test.mjs`.
- [x] The adjudicator is **injectable**, so the wiring decisions are pinned:
      overturn drops, every weaker verdict upholds and counts, an errored session
      upholds, an ambiguous match opens no session at all.
- [x] The prompt's fence asserted by construction — an injection string is proven
      to sit *inside* `<author-rebuttal>`, and `UPHOLD unless` is proven to come
      *before* it.
- [x] **The carry-forward map extracted from the YAML and executed**: the integer
      survives, the adjudicator's prose is stripped, `mergedFrom` counts survive,
      and an undisputed finding carries no key at all.
- [x] Both touched workflows parse.

## The bug that only the end-to-end run found

`groupReviewRounds` projects every carried finding down to
`{lens, severity, file, summary}`. The count was written by the panel and dropped
on the way to the guard — and a dropped count is indistinguishable from "nothing
was ever disputed", so the page would simply never have fired. Unit tests of both
halves passed. See the lessons file.

## Not built

An adjudication record in the metrics comment (the outcome is visible only in the
check body today), and any measurement of how often a rebuttal is *right* — which
belongs in `misses.jsonl`, since an overturn that should not have happened is a
false negative like any other.
