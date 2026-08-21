# Pin a corpus item's review commit instead of deriving it

A **new** document rather than a section appended to
`20260805-eval-corpus-skeleton-todo.md`, which owns the extractor, for the same
reason `20260806-corpus-localization-scope-todo.md` is separate: the code change
is small and the thing that must be findable later is the rule it establishes —
**a review point that cannot be resolved must refuse, never fall back** — which is
about how this tool fails, not about the corpus skeleton.

## The problem

`--review-point` offers four rules for choosing which commit of a pull request to
freeze: `pr-open` (the default), `first`, `head`, `auto`. Every one of them is a
**guess at which commit a reviewer read**, made from the PR's own metadata.

The guess is not always available, and it is not always right. Whenever the answer
is already a matter of record — this repository's own CodeRabbit reviews name the
commit each was posted against, on every PR — it is a **per-PR fact**, and no rule
over `createdAt` and the commit list reproduces it. Checked against seven merged
PRs of this repository (#415, #429, #465, #471, #524, #549, #605), `pr-open`
lands on that commit for **two of the seven**; for the rest it picks an earlier
one, so a diff frozen by the rule and a review of that PR are about different code.

There was no way to say so. `REVIEW_POINTS` is a closed list of four and
`resolveReviewPoint` has no other input, so a caller who knows the answer has to
choose the rule that comes closest.

### Why the failure direction is the whole design

**A `pr-open` freeze and a pinned freeze produce output of identical shape.** Same
four files, same fields, same exit code, same log line. Nothing about the wrong
one looks wrong, and everything downstream — replays, scores, a report — inherits
it silently.

That is why this is not a flag with a fallback. A pinned commit that cannot be
honoured **refuses**, at whichever door the mistake arrives at:

| Mistake | Where it is caught | Exit |
|---|---|---|
| an entry that is not `<pr>=<sha>` | `parseReviewCommitPins`, before `--prs` is read | 2 |
| an abbreviated sha | same | 2 |
| the same PR pinned twice | same | 2 |
| a pin naming a PR not being frozen | `assertPinsAreRequested` | 2 |
| a sha that does not resolve in `--repo-source` | `assertPinnedCommitsResolve`, before the loop | 1 |

The last one is the interesting one, because it is the only failure in this module
that is **not** a per-PR skip. Everywhere else, one flaky PR costs itself and
nothing else — that isolation is deliberate and it is right. A pin that does not
resolve is not a flaky PR. It is the operator's list being wrong, and the
remaining items would be frozen at a review point nobody asked for while the run
reported a partial success. So the pre-flight resolves every pinned sha **before
one item is extracted**, and names all the bad ones at once.

## The change

`scripts/agent/eval/extract-corpus.mjs`:

- **`--review-commit pr-415=<sha>,429=<sha>`** — a per-item map. Per item because
  the commit a review was written against is a fact about one pull request; there
  is no batch rule that produces it, which is the whole point.
  `parseReviewCommitPins` is pure and exported.
- **`REVIEW_POINT_PINNED = "pinned"`**, recorded in `meta.review_point` so a
  manifest says *which rule produced its snapshot* — and "we chose this
  deliberately" is distinguishable from all four guesses.
- **`REVIEW_POINTS` is unchanged at four**, and `REVIEW_POINT_VALUES` is the union
  of five. The two are different vocabularies: the modes are what a caller may
  **ask for**, the values are what the field may **hold**. `--review-point pinned`
  is refused, because there is no commit it could resolve to on its own — it would
  hand a run that meant to pin a mode with no pin attached.
- **`fetchPinnedCommit`** fetches the commit by bare full sha and pins it at
  `refs/eval/pin/<n>`. `refs/pull/<n>/head` is not sufficient: a force-push can
  remove the reviewed commit from a PR's commit list while it stays present on the
  server, and an unreachable object is one `git gc` from gone.
- Full 40-character shas only. `git` would resolve an abbreviation today and could
  resolve it elsewhere after the next fetch; a corpus item is forever.

`corpusItemDrift` needed no change — it already compares `review_commit` and
`review_point`, so moving an already-frozen item's snapshot is caught by the
determinism check rather than overwriting it. Verified against real data below.

## Corrected while building

**`review_base` does not move with the pin, and the plan said it would.** The
working note driving this change asserted that `review_base` is derived as
`merge-base(base branch, review_commit)`, so pinning a commit that is a *merge of
the base branch into the PR branch* would move it. It is not derived:
`resolveReviewPoint` returns `view.baseRefOid` in every mode, and it is a property
of the pull request rather than of our snapshot.

Left as it is, deliberately. What the diff is actually taken from is
`merge-base(refs/eval/base/<n>, review_commit)` inside `fetchDiff`, and that
**does** follow the pin — measured, it moves for both merge commits. The three-dot
forms make the two agree anyway (`A...B` is `merge-base(A,B)..B`), so changing
`review_base` would alter no diff and would make every already-frozen item drift
on a field that describes the PR. The fork point the diff was taken from is
recorded implicitly, by `sha256_diff`.

**The pin lookup and its guard have to normalise identically.** The first version
trimmed the PR number in `assertPinsAreRequested` and not in the lookup that
follows it. A caller passing `[" 664 "]` then passed the guard and **missed the
pin**: the item froze at `pr-open`, the run exited 0, and nothing said so. It
survived nine mutations before a tenth caught it, and the test that now covers it
exists only because the mutation pass went looking.

**A pinned item cannot sit beside its own earlier freeze.** Corpus items live at
`corpus/items/<id>/` with `id = pr-<n>`, which is **not scoped by corpus version**,
and `putCorpusItem` is write-once. Two corpus versions that both index `pr-415` at
different commits are therefore not representable. This is a store-layout fact
that no flag on this module can change, and it is recorded here because the next
person to plan a re-freeze will assume otherwise, as this plan did.

## Fail directions

| When this fails | What happens | Why that is the safe way |
|---|---|---|
| a pinned sha does not resolve | the **whole run** refuses, exit 1, nothing written, every bad item named | the alternative freezes the other items at a review point nobody asked for and reports partial success. Re-running with a corrected list is cheap; working out which items in a version are the ones you meant is not |
| a pin names a PR not being frozen | usage error, exit 2, before the network | the pin is simply never consulted, so every item freezes at the default rule and the run exits **0**. The healthiest-looking failure available |
| an abbreviated sha | usage error, exit 2 | it resolves today and can resolve elsewhere after the next fetch, and the item it produced would already be immutable |
| `--review-point pinned` | usage error, exit 2 | a mode with no pin attached, which is the fallback this flag exists to prevent |
| GitHub will not serve the bare sha | `fetchPinnedCommit` returns false and the pre-flight refuses | a commit that cannot be fetched cannot be replayed either; failing at freeze time is failing while it is still free |
| the pinned commit is already local | no network at all, and the ref is written anyway | present-but-unreachable is the state that expires, so it is the state worth pinning |
| `git update-ref` fails | the fetch still counts as success | a ref we could not write is a durability loss, not a correctness one |

## Explicit non-goals

- **This module does not learn what CodeRabbit is.** No call to `/pulls/*/reviews`,
  no `--review-point coderabbit`. The freezer's headline property is that it is
  deterministic and invokes nothing; a mode that went and looked would make its
  output depend on a third party's records at the moment it ran. The caller
  supplies the sha.
- **`review_base` is not re-derived** — see *Corrected while building*.
- **`additions` / `deletions` / `scope` still are not in `corpusItemDrift`.** That
  gap is named in the existing comment and is not this change's to close.
- **No item-id namespacing.** Making two corpus versions hold the same PR at
  different commits would mean changing item identity, which `labels/` keys on.
- **Nothing here spends money.** `gh` and `git` only, as before.

### One thing a consumer will hit, and it is not fixable here

A replay lane that materialises each item by fetching `refs/pull/<n>/head` and
then asserting `review_commit` arrived **will refuse a pinned item whose commit a
force-push removed from that ref**. Measured on #415: `51c01826` against the PR's
head `eeda30c7` compares as *diverged* (ahead 3, behind 1), so it is not in the
pull ref and never will be.

The fetch such a lane needs is the bare-sha one this module already performs, and
it works: `git fetch --depth=1 <url> 51c01826aa9f05e4cef9ee498668e3f2321b3602`
exits 0 in a virgin clone and the object arrives, even though it is unreachable
from every ref on the server. `fetchPinnedCommit` is the working reference for it.

## Verification

- [x] **1477 tests, 0 fail, 6 skipped** — from the **committed tree**
      (`git archive <branch> | tar -x`), against a freshly measured
      `upstream/main` baseline of **1468 / 0 fail / 6 skipped** at `e1d141e13`,
      same command (`cd scripts/agent && node --test-timeout=60000
      --test-force-exit --test '**/*.test.mjs'`). `main` moved twice while this
      was being built; both numbers are from the same sha, measured minutes
      apart. The 6 skips are the documented pair of causes: 1 Agent SDK, 5
      `lint-config` without a root install.
- [x] **`eslint scripts` exits 0** on the committed tree, at the lockfile's
      pinned `eslint@9.24.0`.
- [x] **Every new test mutation-tested — 10 mutations, 10 caught.** Including the
      two that matter: `resolveReviewPoint` ignoring the pin (5 tests red) and
      `extractCorpus` never passing it to `extractItem` (4 red) — both of which
      are precisely the silent degradation to `pr-open`.
- [x] **DRIFT verified positively, on real data.** Re-extracting the seven frozen
      pilot items at their pinned commits reported DRIFT on **7 of 7**, exit 1,
      nothing overwritten. Two of them — `pr-471` and `pr-524`, whose pinned commit
      *is* their `pr-open` commit — drifted on `meta.review_point` **alone**, which
      is the field doing exactly the job it was added for.
- [x] **Determinism.** Freezing seven pinned items into an empty root and running
      the same command twice more: `froze 7` → `7 unchanged` → `7 unchanged`,
      zero DRIFT, exit **0**.
- [x] **Every refusal path, end to end against the real repository:**
      unresolvable sha → 1 · abbreviated sha → 2 · pin for an unrequested PR → 2 ·
      an entry with no `pr-` → 2. Nothing written by any of them.
- [x] **The diff really is taken at the pinned commit**, not merely labelled with
      it: `diff_method=fork-point` on all seven, and the sizes move exactly as an
      independent `merge-base`-based measurement predicts, including for the two
      pinned commits that are merges of the base branch.
- **Not verified: a pinned commit that GitHub refuses to serve by bare sha.**
  Every commit reachable for this work was servable, so the false branch of
  `fetchPinnedCommit`'s fetch is covered by an injected fake and not by a live
  server that says no.

      Still true as of 10 Aug 2026, and now over production data: all seven
      frozen corpus items pin a `review_commit` and every one of them resolved.
      The feature is exercised; this branch of it is not.
- **Not verified: `--review-commit` under `--review-point head`.** The pin
  overrides the mode in `resolveReviewPoint` (unit-tested over all four
  modes), but `head` is the one mode that skips `fetchPrRefs` entirely, and
  that combination has not been run against the network.

      Checked 10 Aug 2026: **every one of the seven frozen items records
      `review_point: "pinned"`**, so no stored extraction has taken the `head`
      path with a pin. The combination remains unexercised outside unit tests.
