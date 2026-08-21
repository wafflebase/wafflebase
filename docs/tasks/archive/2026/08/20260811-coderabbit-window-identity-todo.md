# Place a finding that sits ON the frozen review commit as in-window

*Follow-up to `archive/2026/08/20260807-coderabbit-adapter-todo.md`, which shipped
`placeInWindow` in #739 and is now archived. This is one check in that function and
one key in `WINDOW_BASIS`; everything else about the adapter is unchanged and its
own doc still holds.*

`placeInWindow` asked the pull request's commit list a question it already had the
answer to, and returned `unplaceable` for three findings that are in-window by
construction. One check moves; `WINDOW` does not change.

## The problem

`placeInWindow` returned `unplaceable` for a finding whose own commit **is** the
item's frozen `review_commit`, whenever a force-push had since removed that commit
from the pull request's commit list.

The order of checks was the whole defect. The function asked *"where is
`review_commit` in `commits`?"* first, and bailed with
`review-commit-not-on-pr` before it ever compared `atCommit` to `reviewCommit`:

```js
const reviewIdx = commitIndex(list, reviewCommit);
if (reviewIdx < 0) return basis("review-commit-not-on-pr");   // ← bailed here
if (str(atCommit).trim() === "") return basis("commit-absent");
const at = commitIndex(list, atCommit);
```

So the function reported that it could not place a finding **while looking at the
exact commit that finding's review was posted against**.

Measured over the pilot corpus (`2026-08-10-pilot-reviewed`, 7 items) on
2026-08-10, before the change:

```
30 record(s) across 7 item(s), population reported
  window:   unplaceable=3 in-window=27
pr-415: 3 record(s) · window review-commit-not-on-pr=3
```

All three were pr-415's, and all three are in-window **by construction**: that item
is frozen at `51c01826aa9f05e4cef9ee498668e3f2321b3602`, which is the commit
CodeRabbit's only review on #415 sits on. The pull request no longer lists it —
`gh api repos/{owner}/{repo}/compare/51c01826a...eeda30c75` reads
`{"ahead":3,"behind":1,"status":"diverged"}`, and `pulls/415/commits` returns the
single sha `eeda30c751a4d215924bd8ecd379f769b869be6b`.

**Why this is wrong independently of any benchmark.** Ordering exists to answer
*"is this commit before or after that one?"*. When the two commits are the same
commit there is nothing to order, and refusing to answer is simply incorrect. The
input the old code needed — the pull request's commit list — is **mutable**, and
the input it already had — the two shas — is not. A function that discards an
answer it holds in favour of one that can be taken away by a later force-push has
the dependency backwards.

## The change

One check moved, one basis added, two tests.

```js
if (str(reviewCommit).trim() === "") return basis("no-review-commit");
const list = Array.isArray(commits) ? commits : null;
if (list === null || list.length === 0) return basis("commits-unavailable");
if (str(atCommit) === str(reviewCommit)) return basis("commit-is-review-commit");  // ← new
const reviewIdx = commitIndex(list, reviewCommit);
if (reviewIdx < 0) return basis("review-commit-not-on-pr");
```

The comparison is `commitIndex`'s own, whole string against whole string: the two
must never disagree about which shas are one commit, which is the same reason the
ordering rule is composed from `commitIndex` rather than re-implemented beside it.

`WINDOW` is untouched — still the same frozen four values. This case **is**
`in-window`; a fifth value would be a schema change every consumer has to learn,
for a case the existing vocabulary already has a word for.

`WINDOW_BASIS` gains one key, `commit-is-review-commit` → `in-window`. That is the
cheap half of the pair by design, and it is where the honesty belongs: the census
prints the basis, not the value, so *how* each finding was placed stays visible.
`commit-at-or-before-review` would have been true of these records — but it claims
the commit list was consulted, and for this branch it was not.

### Why a distinct basis rather than reusing `commit-at-or-before-review`

The two answers are reached by different means and one of them survives a
force-push. Merging them would make the census unable to say which findings were
placed from the two shas alone and which needed the pull request's history — and
`window_basis` exists precisely because `window` alone could not distinguish an
unreadable commit list from a real force-push (the defect this file's first live
run produced). Adding a key to a map is cheap; the earlier decision that a value
of `WINDOW` is *not* cheap still holds.

The visible consequence is larger than the three findings that motivated it, and
worth stating plainly: on this corpus version **every** record's commit equals its
item's frozen commit, so the basis census moves from
`commit-at-or-before-review=27 · review-commit-not-on-pr=3` to
`commit-is-review-commit=30`. `window` is unchanged for the 27 and corrected for
the 3. That the ordering basis now appears on **no** pilot record is itself a fact
worth being able to read — pooled into one key, the census could not say that no
finding in this corpus version needed the commit list at all.

### Why `commits-unavailable` still wins over identity

The identity answer would be just as correct with no commit list at all, and the
check is deliberately **not** hoisted above it. An unreadable commit list is our
failure, it costs the placement of every finding on the item, and the CLI says so
in those words and asks for a re-run:

```
! pr-NNN: the commit list is absent, so all N finding(s) are unplaceable because WE
  could not read it, not because CodeRabbit wrote them outside the frozen window.
```

Answering part of that item from identity would make a whole-item read failure look
partial, and that message would become false. There is no real input where it costs
anything: a pull request whose commits we could not list is one we re-run.

## Corrected while building

**The handoff's own numbers were right; two statements in the file were not.**

1. **The `WINDOW` docblock said "every pilot item is frozen at `review_point:
   pr-open`".** It is not a property of the pilot, it is a property of the corpus
   version: `2026-08-10-pilot-reviewed` freezes all seven items at
   `review_point: pinned`, each at the commit CodeRabbit reviewed. The docblock now
   says `review_point` names the freeze and that the split is a property of the
   freeze rather than of the rule, with **both** measurements dated —
   3/24/3 at `pr-open` (2026-08-07) and 30/0/0 at `pinned` (2026-08-10) — because
   the older one is the argument for why `WINDOW` has four values and is still a
   true statement about that freeze.
2. **The `unplaceable` docblock used #415 as its illustration of the force-push
   case**, which is now the illustration of the case that is *placeable*. Rewritten
   to say what still makes a finding unplaceable — a commit that is neither the
   frozen one nor on the pull request.

**`scripts/agent/eval/README.md` enumerates the basis vocabulary in a table**, so
the `in-window` row was extended with the new basis. This is the only code-adjacent
file touched outside the adapter and its test.

**This work was first written as a fourth section appended to
`20260807-coderabbit-adapter-todo.md`, per the convention that an extension to a
subsystem appends to that subsystem's doc.** `main` archived that doc while this
branch was being measured, which turned the append into a delete/modify conflict —
so it is a new active doc instead, pointing back at the archived one. The index
under `docs/tasks/README.md` is deliberately NOT regenerated here: it is generated
by `pnpm tasks:index`, it is already one row stale on `main` (#759's doc landed
without it), and regenerating would put another pull request's row in this diff.

## Fail directions

| When | What happens | Why that is the safe direction |
|---|---|---|
| The two shas differ by so much as a character | falls through to the existing ordering rules, ending in `unplaceable` if neither can be located | The fail direction is unchanged: never claim `in-window` on a guess. An abbreviated or prefix sha is **not** identity — pinned by a test over four near-misses, including the 39-character prefix and the upper-cased sha |
| `reviewCommit` is empty | `no-window`, before identity is considered | Otherwise an empty `atCommit` would "equal" an empty `reviewCommit` and every off-corpus finding would report `in-window`. The existing first check is what prevents it, and a test pins both-empty at `no-window` |
| The commit list cannot be read | `commits-unavailable`, still, even for an identical sha | Our failure stays our failure, and stays whole-item |
| `review_commit` is on the pull request and the finding's commit is not | `commit-not-on-pr`, unchanged | The genuine force-push case keeps its own basis |

## Explicit non-goals

- **No new `WINDOW` value.** Four, frozen, as before.
- **No re-extraction and no re-freeze.** The frozen bytes were correct; the
  placement logic was not.
- **No filtering by `window` anywhere.** The rule still tags.
- **`harvest.mjs`, `finding-record.mjs` and `commitIndex` are untouched.** The
  ordering rule is still composed from the parser's own reader.
- **The stale repo-wide and pilot-wide census numbers elsewhere in
  `eval/README.md` were not re-measured.** They are dated and attached to a named
  corpus version; re-stating them is a different piece of work from this one.
- **No case-insensitive or abbreviated sha matching.** `commitIndex` compares full
  shas exactly and so does this.

## Verification

Measured at `upstream/main` = `940a0dc9c`, from the **committed tree**, with
`scripts/agent/node_modules` symlinked into **both** the base and the branch tree
before either was measured, and both lanes run serially rather than concurrently.

- [x] **A fixture in the pr-415 shape returns `in-window` with a basis that names
      why** — `reviewCommit` = `atCommit` = `51c01826a…`, `commits` = the single
      `eeda30c75…` the pull request actually has:
      `{ window: "in-window", window_basis: "commit-is-review-commit" }`, asserted
      through `placeInWindow` and again end to end through `codeRabbitRecords`.
- [x] **The genuine unplaceable cases all still fire** — `review-commit-not-on-pr`
      (finding on a different commit, with and without a commit of its own),
      `commit-not-on-pr`, `commit-after-review`, `commits-unavailable` (which
      still wins over identity), and four near-miss shas that must not be read as
      identity.
- [x] **Mutation-tested, twice, and restored after each.**
      1. Identity check moved to *after* the `review-commit-not-on-pr` bail — the
         defect, put back: **1 test red**, naming the right thing.
         `expected { window: 'in-window', window_basis: 'commit-is-review-commit' }`,
         `actual { window: 'unplaceable', window_basis: 'review-commit-not-on-pr' }`.
      2. Identity returns `commit-at-or-before-review` instead of the new key —
         **2 tests red**, so the basis is pinned and not merely the value.
- [x] **The real census, re-run over `2026-08-10-pilot-reviewed`**, 7 items,
      n=30, from the branch tree:

      ```
      30 record(s) across 7 item(s), population reported
        window:   in-window=30
      pr-415 3 · pr-429 7 · pr-465 6 · pr-471 2 · pr-524 1 · pr-549 5 · pr-605 6
        — all `commit-is-review-commit`
      ```

      Before: `window: unplaceable=3 in-window=27`, the 3 being pr-415's, basis
      `review-commit-not-on-pr`. Nothing else in the census moved: `severity
      major=3 minor=13 nit=14`, `source inline-comment=16 review-body=14`,
      `gating not-applicable=30` are identical on both sides.
- [x] **`agent:tests` lane** — `cd scripts/agent && node --test-timeout=60000
      --test '**/*.test.mjs'`, the command `verify-self.mjs` runs:
      **1613 tests · 1608 pass · 0 fail · 5 skip**, against a baseline measured the
      same way at the same sha with an identically prepared tree:
      **1611 · 1606 · 0 · 5**. **+2 tests, no new skips, nothing red on either
      tree.** The 5 skips are `lint-config.test.mjs` without a root install; the
      Agent SDK *is* installed in the symlinked `scripts/agent/node_modules`, so
      there is no sixth.
- [x] `eslint scripts` exits 0 on the lockfile's pinned **9.24.0**, no output. (A
      bare `npx eslint` resolves 10.8.1 here and the root config's `@eslint/js`
      import needs a root install, so 9.24.0 plus `@eslint/js` and `globals` were
      installed into a scratch tree and linked for the run only.)

**Measured twice, and the first pair is worth recording.** This branch was built
and measured at `ae9375e0b`, where the lane read **1573 · 5 skip** against a
**1571 · 5 skip** baseline — the same +2 — but with red in both runs: 2 in the
branch run (`eval/run.test.mjs`, the `os.tmpdir()` `eval-item-*` /
`eval-lenses-*` assertions) and 8 timeouts in the base run under a 74-minute wall
clock. Neither set was this diff's, and `eval/run.test.mjs` passed 50/0 alone on
both trees. **#760 then landed on `main` and reaped the stub panel's processes,
and the same two trees at `940a0dc9c` are green.** The numbers above are the
second pair; the first is kept here because "the lane was red and it was not mine"
is a claim that should not evaporate once it stops being true.

**Not verified, and why:**

- **`after-window` is not exercised by any pilot record**, because every item in
  this corpus version is frozen at the commit CodeRabbit reviewed. It is covered by
  unit tests only, and the `pr-open` freeze measured on 2026-08-07 is the last real
  data behind it.
- **Nothing downstream consumes `window` yet**, so no metric moved. What moved is
  which findings a metric will see when one exists.
