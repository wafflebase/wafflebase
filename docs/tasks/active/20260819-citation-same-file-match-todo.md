# Locate the findings the provenance gates were silently dropping

## The problem

#881 froze the review surface so a finding on fixer-written code stops gating. It
works, but it can only judge a finding it can **place** — and measured against the
44 blocking findings banked on the open draft agent PRs, it could place 7.

**The cohort, stated precisely:** 9 open draft agent PRs. **8** carried banked
blocking findings, totalling the 44 measured here. #695 is excluded because it has
none to measure — its latest round came back genuinely clean, all six lenses
returning `[]`. (#810 is not in the set: it has since been promoted out of draft.)
The other 37 came back `unknown`, which keeps them blocking, so the gate was inert
against 84% of the backlog and a bare `@claude rerun` would have bought a 9%
reduction.

`findingLocation` was dropping locations for two independent reasons, both of them
bugs rather than policy:

1. **It read only the FIRST citation.** `parseCitation` returns
   `CITATION.exec(...)` — one match — and `findingLocation` discarded it whenever it
   named a different file than the finding's own. But lenses habitually open their
   evidence with the call site or the contract being violated and cite the file the
   finding is filed under second. A `correctness` finding on `auth.controller.ts`
   whose evidence begins `cli-auth.store.ts:39` got no line at all, even though
   `auth.controller.ts:130` sat two clauses later. Of the 24 findings that carry a
   citation naming their own file, only 7 had it first.

   The function's own docblock — and `docs/design/harness-engineering.md` — already
   described it as taking "the first **same-file** citation in its evidence". The
   code never did. This makes the code match its documented contract.

2. **Punctuation abutting a citation was parsed as part of the path.** `CITATION`'s
   leading `[^\s:]+` is permissive about path shape, so it also swallows whatever
   character precedes the citation — and lenses cite in prose, so that is usually a
   paren or a backtick. `(auth.controller.ts:130-135)` parsed as the file
   `(auth.controller.ts`, which no path comparison can ever match. This affected the
   existing first-citation path too, so it was losing locations before #881 existed.

Both gates read this one function, so every lost location cost the novelty gate a
judgement as well as the surface gate.

## The fix

- `scripts/agent/citation.mjs` — new `parseCitations` returning every **valid,
  normalized** citation in source order. Not "every citation": a token whose line
  number locates nothing (`a.mjs:0`) is dropped rather than returned, and each path is
  normalized by the shared `pieces` helper, so every element of the array is a usable
  location. `parseCitation` keeps its exact existing contract — the first match — for
  the grounding checks, which only ever need one.
- The `pieces` helper now trims **prose wrappers** off the front of a path. This is a
  denylist of punctuation (`( [ { < " ' \` *` and typographic quotes), NOT an allowlist
  of legal path starts: an allowlist strips whatever it was not told about, which
  silently corrupts real filenames — `+page.svelte:12` became `page.svelte`, which
  matches nothing, reproducing the very bug the trim exists to fix.
- `scripts/agent/novelty.mjs::findingLocation` — scan for the first citation that
  AGREES on the file instead of testing only `cited[0]`.

The same-file rule itself is unchanged; only where it looks moved. A finding whose
evidence cites many files, none of them its own, still gets no line — pairing a
foreign file's offset with this finding's file invents a location that means
nothing, and that reasoning is why the rule exists.

`CITATION` is deliberately NOT tightened. Its other three importers only ask
`.test()` — "does this cite anything at all" — and narrowing the predicate could
turn a grounded verdict ungrounded, which is a gate change nobody asked for.

## Measured effect

Real `surfaceOf` calls against real branch checkouts, over the findings actually
persisted on the eight PRs' latest rounds:

| | before | after |
|---|---|---|
| located blocking findings | 7 | **23** |
| would demote (out-of-scope major) | 4 | **11** |
| kept, in-scope | 3 | 12 |
| unlocatable (never routed) | 37 | **21** |

So the surface gate goes from demoting 9% of the banked backlog to 25%, and it is
demonstrably not indiscriminate — it now judges half the findings and keeps half of
those on the gate.

The residual 21 genuinely carry no same-file citation: 11 cite only other files, 9
have evidence with no citation at all, 1 has no evidence field. Those are a lens
prompt/rubric question, not a parsing one, and are out of scope here.

## Tasks

- [x] `parseCitations` + shared `pieces` with the path-start trim
- [x] `findingLocation` scans for the first same-file citation
- [x] Tests: ordering, punctuation, singular/plural agreement, same-file rule intact
- [x] Mutation-test every guard (6/6 caught)
- [x] Full `agent:tests` lane green
- [x] Re-measure against the live PRs

## Two things this surfaced about the code, worth recording

**An unreachable guard, found by mutation.** I added
`if (file === "" || !file.includes(".")) return null;` to `pieces`, and its mutation
SURVIVED — because `CITATION` only matches a token carrying `.` + an extension
before the colon, and `.` is inside the trim's allowlist, so the trim can never
strip past it. The state the guard defended against cannot occur. It was removed
rather than given a test, because an unreachable guard is worse than none: it
implies a case that cannot happen and no test can hold it honest.

**A comment that overstated a guard.** The per-call `g`-flagged regex in
`parseCitations` was documented as preventing `lastIndex` poisoning. Measurement
says otherwise: `matchAll` iterates an internal clone and never advances
`lastIndex`, and an `exec` loop advances it but `exec` resets it to 0 on the miss
that ends the loop — so a shared module-level copy is behaviourally identical, and
mutations installing one survive by being genuinely equivalent. The construction is
kept as a cheap convention (it forecloses a future partial scan with an early
`break`) and the comment now says exactly that. A comment claiming a guard is
load-bearing when it is not is the same defect class as a vacuous test.
