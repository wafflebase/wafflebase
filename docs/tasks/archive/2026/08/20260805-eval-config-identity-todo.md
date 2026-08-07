# Config identity: what settings produced this review?

Two modules under `scripts/agent/eval/`. `config-hash.mjs` reduces a config manifest
to a fingerprint of the **configuration** it describes; `config-build.mjs` turns the
lenses directory into that manifest plus a self-contained snapshot, and turns a
snapshot back into a lenses directory the panel can load.

Neither invokes a model, and `review-panel.mjs` is unchanged — the panel keeps reading
`scripts/agent/lenses/lenses.json` exactly as it does now, so no review of a real pull
request behaves differently.

What *does* change is what a **replay** off a materialised snapshot does, and it is the
point of the change rather than a side effect: such a replay used to run every lens at
`high` over the whole diff, and now runs each at its declared effort over its declared
file classes. That is a behaviour change in the replay path toward the behaviour
`lenses.json` already specifies — the lenses' intended behaviour is preserved, where
before it was silently discarded.

## The problem

The panel is tuned by editing `lenses.json`: a model, a sample count, a reasoning
effort, which file classes a lens reads. **Nothing in this repository can answer
"what settings produced that review?"** A check run records a verdict; the manifest
behind it is whatever was on `main` at the time, and after two more tuning commits
that is no longer recoverable. The sharper form — *were these two reviews even
produced by the same reviewer?* — has no answer at all.

A fingerprint of the manifest answers the first question outright. It answers the second
only in part, and the distinction is load-bearing enough to state before anything else:

- **`config_hash` is CONFIGURATION identity.** It is derived from the manifest, so it
  says whether two runs were configured the same way — same lenses, models, efforts,
  scopes, rubrics.
- **The pair `(config_hash, panelSha)` is IMPLEMENTATION identity** — the reviewer.
  `config_hash` cannot see the panel's code, so a new verifier stage or a changed gate
  leaves it identical. `panelSha` (`capture-meta.mjs`, #673) supplies that half.

So "same reviewer" is a claim about the pair, never about `config_hash` alone. Decision 4
below is where that is argued; it is said here because a reader who takes the first
sentence as "the hash identifies the reviewer" has the wrong model of the whole file.

Either way a fingerprint has two ways to be wrong, and they are **not symmetric**:

| | consequence |
|---|---|
| hashes the **same** when behaviour **differs** | merges two reviewers into one population. Nothing fails, nothing is logged, and the error surfaces as a comparison nobody can explain |
| hashes **differently** when behaviour is **identical** | splits a population, which shows up immediately as fewer matching results than expected |

The version this replaces was wrong in **both** directions at once.

### Five divergences, and the one mistake underneath four of them

Verified at `upstream/main` `82c7519d7`, re-derived at `bb21ff953`.

| # | Where | What | Direction |
|---|---|---|---|
| 1 | `normalizeLens` | omits `scopeClasses` | **false negative** — a code-only lens and an everything lens hash identically |
| 2 | `normalizeLens` | omits `effort` | **false negative** — two lenses differing only on the panel's main cost dial hash identically |
| 3 | `normalizeLens` | hand-mirrors the panel's `samples` default | **false positive** — see below; not the divergence the audit predicted |
| 4 | `buildConfig` | rebuilds each lens from a hardcoded seven-field list, dropping `scopeClasses` **and** `effort` on the way IN | silent loss |
| 5 | `materializeLenses` | the same seven-field list, dropping both again on the way OUT | silent loss |

1, 2, 4 and 5 are one mistake: **a field was added to `lenses.json` and nobody
updated a hardcoded list.** `scopeClasses` arrived with #582's file-class routing;
`effort` arrived later. Both lists were written before either.

**Divergences 4 and 5 are the same bug at the two ends of one round trip, which is
why neither was caught.** The old test asserted
`buildConfig(materializeLenses(snapshot)) === the original hash` — and it passed,
because a snapshot built and materialised by the same broken pair is perfectly
self-consistent. A round trip cannot see a field that neither of its ends carries.

### What divergence 5 cost, measured

A materialised lenses dir carried **no `effort` on any lens**, so the panel saw
`undefined` everywhere, `assertEffort` passed it (unset is legal), and all six
lenses ran at the SDK default `high`. Production runs **five of six at `medium`**.
Measured by materialising the real `lenses.json` through both versions:

```
SOURCE lenses.json (what production runs):
  correctness     medium             ["code","code-adjacent","policy"]
  security        <absent> -> high   ["code","code-adjacent","policy","design-spec","prose"]
  design-fit      medium             ["code","code-adjacent","policy","design-spec"]
  test-adequacy   medium             ["code","code-adjacent","policy"]
  blast-radius    medium             ["code","code-adjacent","policy"]
  docs            medium             ["prose"]

BEFORE — every lens: effort <absent>, scopeClasses <absent>
  -> the panel would run: [high, high, high, high, high, high]

AFTER
  -> the panel would run: [medium, high, medium, medium, medium, medium]
```

So every replay silently upgraded 5 of 6 lenses on what `review-panel.mjs` calls
*"the panel's main cost dial"* — a different reviewer **and** a more expensive one.

Note the shape, because it is the third instance of it in this subsystem: upstream
anticipated this failure precisely. `assertEffort` exists because an unrecognised
value *"would otherwise be dropped and the session would run at the default `high`,
which is a silent COST regression — no error, no changed output, nothing in the
logs."* It catches a **wrong** value. It cannot catch one **deleted upstream of
it**. **A validator only guards the door it stands in.**

And `scopeClasses` dropped means `lensScope` sees an omission, which it treats as
EVERYTHING by design — so every replayed lens read the **whole** pull-request diff
instead of its file-class slice.

## The change

**1. `normalizeLens` hashes the effective value of every field the panel reads.**
Not the raw manifest value: the value the panel actually acts on. `appliesWhen`
already worked this way (absent → `["**"]`); the rest now do too.

**2. The panel's defaults arrive by import, not by copy.** `FILE_CLASSES` and
`sampleCountFor` come from `review-panel.mjs`. A hand-copied default that drifts
from the panel is exactly the false negative this module exists to prevent.

**3. Both directions of `config-build.mjs` copy the whole lens object.** The
seven-field allowlists are gone. `buildConfig` spreads `{...l}` and adds three
derived keys; `materializeLenses` spreads and removes a **denylist** of those same
three. "Adapters widen, never narrow" — a denylist of three can only ever drop
those three; an allowlist of seven drops everything anyone adds next.

**4. The guard, which is the actual deliverable.** Fixing five instances of a
hardcoded list buys nothing past the next field. Three assertions now hold the
hashed-field list against reality:

| guard | what it reads | catches |
|---|---|---|
| every key in the **real `lenses.json`** is hashed or named cosmetic | the live manifest | a field someone sets |
| every `lens.<field>` **`review-panel.mjs` reads** is hashed or named cosmetic | the panel's source | a field the panel *consumes* but no lens sets yet |
| `HASHED_LENS_FIELDS` equals the keys `normalizeLens` actually emits | the canonical form | the list drifting from the code, which is the invariant the old header **claimed** and no test held |

The second is the stronger one, and it earned its keep on day one: it found a
**sixth divergence**. `maxTurns` is read at `review-panel.mjs:1782`, is
behaviour-determining (capping `docs` at 8 turns made it die on `error_max_turns`,
which fails a blocking lens closed and pages a human), and was absent from the hash.
No lens sets it today — which is precisely why a guard reading only `lenses.json`
could never have seen it.

Excluded fields live in `COSMETIC_LENS_FIELDS` / `COSMETIC_CONFIG_FIELDS` as
**field → written reason**. The reason is data, not a comment, so a test can require
one: a field cannot leave the hash without somebody writing down why.

Deliberately **not** a golden hash string. A test pinning `sha256:9f2c…` goes red on
every legitimate manifest change and teaches whoever is on the other end to update
the constant, which is how a guard becomes a formality.

**5. `scripts/agent/eval/README.md` says these modules exist.** Two rows in *"What
exists today"* and one clause deleted from the not-built-yet sentence, which named
config identity. Small, and the reason it is in this change rather than a follow-up:
that sentence is the first thing a reader of the directory sees, and a README that
says the thing you just landed does not exist is the same silent-staleness failure in
documentation form. A follow-up would also cost a second review cycle for two lines.

## Corrected while building

**The `samples` divergence runs the opposite way to the one the audit predicted, and
the fix is not the one it proposed.** The audit read `config-hash.mjs`'s
`Math.max(1, Number(lens.samples) || 2)` against `Math.max(1, Number(samples) || 1)`
in the panel and concluded the default had drifted 2 → 1, so an omitted `samples`
hashed as 2 while the panel ran 1.

The panel's authoritative default is **`sampleCountFor`** (`review-panel.mjs:1716`),
which is exported, tested upstream (*"the panel's default is 2 samples per lens"*),
and returns **2**. The `|| 1` the audit found is inside `createWarmupGate`, applied
to a value `sampleCountFor` has **already normalised** — a defensive floor on
something already ≥ 1, not a default. So `|| 2` was correct.

The divergence is real but lives elsewhere, and it is the **false-positive**
direction after all:

| `samples` | panel runs | fork hashed | |
|---|---|---|---|
| `2.5` | 2 (`Math.floor`) | `2.5` | splits one population in two |
| `1e999` | 2 (non-finite → default) | `Infinity` | splits it from an omitted `samples` |

Calling `sampleCountFor` kills the whole class rather than the two known inputs. Its
own docblock says *"three call sites have to agree EXACTLY"*; this is the fourth.

**`gating` is a string in the manifest and a boolean in effect.** Both consumers
compute `String(lens.gating ?? "blocking") === "blocking"` — `review-panel.mjs:2410`
and `agent-review-panel.yml:847` — so `"advisory"` and a typo'd `"blockign"` are the
same reviewer, and hashing the raw string split them. Now hashed as the boolean.

**`appliesWhen` short-circuits on `includes("**")`**, so `["**", "packages/**"]` is
the same reviewer as `["**"]`. Also collapsed.

**Two of my own guards were broken, and both failed the way this project's guards
usually fail.** The panel-source scan first used `/\blens\s*\??\.\s*(\w+)/`, and the
tolerant `\s*` matched **prose**: sentences ending *"…per lens."* followed by a
capitalised word produced four phantom fields (`Each`, `Keep`, `Not`, `const`).
Requiring no whitespace before the dot fixes it. Comments are **not** stripped: a
hand-rolled JS comment stripper mis-handles strings, template literals and regex
literals, and its failure mode is dropping a real read — a false **green**. Matching
a field named inside a comment is the other direction: one more field to classify,
never one fewer. And the guard-of-the-guard used `assert.throws`'s return value,
which is `undefined`.

**`--sdk-version`'s hardcoded `"0.3.217"` is not stale.** It is exactly what
`scripts/agent/package.json` pins, and the installed SDK is 0.3.217 too. That is the
least useful state for a duplicated constant to be in — it is the same drift class as
the seven-field lens lists, and correct today is not a property. It now reads the pin.

### Four more, from review — and the first is the one this module exists to prevent

**`localeCompare` made the hash machine-dependent.** `canonicalConfig` sorted lenses
with `a.id.localeCompare(b.id)`. That comparator's collation comes from the runtime —
ICU data plus `LC_ALL`/`LANG` — so it is a *different function on two machines*.
Measured on one manifest with lenses `ch` and `hz`:

```
locale=en-US  sorted=[ch,hz]  sha256:cc480b9bb9a0d68be0c7…
locale=cs-CZ  sorted=[hz,ch]  sha256:58b36ce82392b4d80518…
```

Czech collates `ch` as a single letter after `h`. **One reviewer, two fingerprints** —
a false positive of exactly the kind this file was written to kill, arriving through
the sort rather than through a field. CI runs one locale and a laptop another, so the
only symptom would have been results that quietly refuse to pool. Now a code-unit
comparator, with a test asserting the canonical order *is* code-unit order (checkable
in any locale, unlike switching locale mid-process).

**A lens id is a filename at both ends, and nothing checked it.** An id of
`../escaped` made `buildConfig` read a rubric from outside the lenses dir and
`materializeLenses` write a file outside `destDir` — verified, both. Now refused at
both boundaries, and refused rather than sanitised: sanitising maps two distinct ids
onto one filename, which for this module is the worse failure. `capture-meta.mjs`
already established the idiom for the same reason.

**`rubric_path` named a file it had never opened.** It was the constant
`scripts/agent/lenses/<id>.md` regardless of `lensesDir`, so under any `--lenses-dir`
the one field whose purpose is to say where the bytes came from was false. Now derived
from the file actually read, kept repo-relative when it is inside the repo so a stored
manifest carries no machine-specific layout.

**An omitted `sdkVersion` silently dropped the key.** `JSON.stringify` elides
`undefined`, so a direct caller — PR 5 — that forgot the option got an unattributed
manifest with nothing saying so. It now defaults to the pin.

The panel-source guard also learned to see `const { effort } = lens`. The panel
destructures no lens today, so that catches nothing right now; it is there because a
member-read-only scan would go quietly blind the first time someone wrote it that way,
which is the failure mode the guard exists for.

## The four decisions

**1. An absent `scopeClasses` hashes as the panel's effective value: all of
`FILE_CLASSES`, sorted.** `lensScope` treats an omission as EVERYTHING — *"an
omission must fail toward more review, not toward a silently empty diff."* Hashing
the raw absent value would fix divergence 1 and immediately reopen one of the same
shape, because a lens omitting the field behaves identically to one listing all five
classes. Asserted through `diffForLens` on a real two-file diff rather than against a
copied list, so the equivalence stays tied to the panel's behaviour and not to a
constant.

**2. An absent `effort` hashes as `"high"`.** The prompt for this work allowed a
distinct sentinel if upstream's two comments disagreed. They do not, and there are
**four** independent statements, all re-checked at `bb21ff953`:
`review-panel.mjs:1784` (*"Omitted = the SDK default (`high`)"*), `assertEffort`'s
docblock, `buildSessionOptions` (*"an unset effort takes the SDK default (`high`)"*),
and the pinned SDK's own type docs at `sdk.d.ts:1631` — *"`'high'` — Deep reasoning
(default)"*. So this is an equivalence, not a guess: `security`, the one lens of six
that sets no `effort`, hashes identically to a lens that writes `"high"` out, because
they run identically. Both facts the equivalence rests on are machine-checked
(`EFFORT_LEVELS.includes(DEFAULT_EFFORT)` and `assertEffort(undefined) === undefined`),
so the normalisation cannot outlive them.

A value `assertEffort` would **reject** passes through as written and hashes
distinctly. The panel refuses to start on it, so there is no behaviour for it to be
equivalent to, and splitting is the recoverable direction.

**3. `FILE_CLASSES` is imported, not duplicated — and the import costs nothing.**
The concern was that `review-panel.mjs` pulls in `ask.mjs` and the Agent SDK, and
that `config-hash.mjs` was the cleanest module in the set. Measured instead of
assumed: `ask.mjs` has **no top-level SDK import** — it is `await import(…)` at one
call site (`ask.mjs:508`) — so the whole graph is eight sibling modules and node
builtins. Importing `review-panel.mjs` with **no `node_modules` present at all**
succeeds, has no side effects, and takes ~13 ms.

**All 47 new tests run and pass with zero `node_modules`; skips are unchanged from
`main` at 6.** A duplicate would have needed a test that fails when the panel's list
changes — which is a worse version of just importing the list. The import also buys
`sampleCountFor`, which is what turns divergence 3 from "fix two inputs" into "delete
the copy".

**4. No `pipeline_version`. The pooling key is the PAIR `(config_hash, panelSha)`.**
The hash covers the lens composition, not the panel's code, so a new verifier stage
or a changed gate leaves it identical. That is a real gap and it is **already
closed elsewhere**: `capture-meta.mjs` (#673) records `panelSha`, a validated 40-hex
commit of the trusted `main` checkout that ran the panel, on every capture. Its
header settled this exact question when it chose that field *over* a config hash —
a commit sha *"is always available, always correct, and a config identity can be
derived from it later. A wrong fingerprint is worse than none."*

A hand-maintained `pipeline_version` integer would be a second, weaker source of
truth for a fact already recorded correctly, and nobody bumps those — which is the
drift class this entire module is a fix for. A derived content hash of
`review-panel.mjs` would be honest and would split every population on every comment
edit, which makes pooling impossible rather than merely coarse. So the answer is
recorded in the module header and consumed as two keys, not merged into one.

What **does** land is a vintage for the hash *function*: `CONFIG_HASH_VERSION =
"wafflebase/config-hash@2"`, written into both the manifest and the snapshot. This
PR changes the hash, so a stored `@1` value is not comparable to an `@2` one, and
without a recorded vintage the only evidence of that is a mismatch nobody can
attribute. It is provenance, not hash input: `@2` adds keys to the canonical form, so
the two already differ by construction, and feeding the version in as well would make
every future bump look like a reviewer change.

## The two smaller calls

**`snapshot.captured_at` stays, and becomes injectable.** It is real provenance and
it is excluded from the hash, so identity was never at risk — but a snapshot that is
not byte-reproducible cannot be diffed against another one. PR 3 took the harder line
for corpus items (no wall clock in the payload at all, determinism proved per-file);
consistency here means production still stamps a real time and a caller may pin it.
Tested both ways.

**`--sdk-version` reads `scripts/agent/package.json`, and refuses a range.**
`sdk_version`'s only job is to say which build produced a result. `^0.3.217` does not
say that, so `pinnedSdkVersion` throws rather than record an unfalsifiable claim in a
stored manifest — loud, free, and fixable by passing the flag. The reader is injected
so a test can prove the function **reads** rather than returns a literal: comparing
its result against the same `package.json` it read would stay green over a
re-hardcoded value.

## Fail directions

| Part | On failure | Why that is the safe direction |
|---|---|---|
| `configHash` on a malformed manifest | never throws; degrades to `""`/defaults per field | a read path. Nothing in this codebase's read paths throws, and a fingerprint that crashes on a bad manifest is a fingerprint nobody can compute for the case they most need it |
| `buildConfig` on an invalid `effort` | **throws**, naming the lens and the file | the single write path refuses on any doubt. The panel validates every `effort` before the first token is spent; a snapshot of a config the panel would refuse to start on is a guaranteed-wasted replay, and it is cheaper to find out here |
| `pinnedSdkVersion` on a range or a missing dependency | **throws** | a wrong recorded SDK version is worse than an absent one: it attributes a result to a build that never ran it |
| an unrecognised `scopeClasses` value (`["banana"]`) | hashes distinctly, though it selects no hunks | over-sensitive, knowingly. Intersecting with `FILE_CLASSES` would mean modelling `classifyFile`'s whole range here, and splitting a population is visible while merging two reviewers is not |
| an omitted `model` | hashes as `""`, which is not the SDK's default | the SDK publishes no default model, so there is no value to normalise to. Splits rather than merges |
| the panel-source scan stops matching | **red**, via a floor naming all eleven fields the panel reads today | a scan that silently matches nothing is the #676 failure — an assertion that passed for the wrong reason |
| a new field in `lenses.json` | **red**, naming the field and both places to classify it | the whole point |

## Explicit non-goals

- **No model invoked, no API key, no spend.** Everything here is `crypto` and `fs`.
- **#677's code untouched** — `eval/store.mjs` and `eval/extract-corpus.mjs`. Nothing
  here reads or extends the store. `eval/README.md` **is** edited, by two rows and one
  deleted clause, because it is the file that tells a reader what this directory
  contains and it would otherwise state that the thing this change lands is unbuilt.
  That edit was held back while #677 was in flight — two branches editing one file is a
  conflict for no benefit — and taken once it merged.
- **No store method for persisting a snapshot.** The CLI takes an output path;
  wiring config into a run is the runner's job.
- **Not the runner.** Nothing here replays anything.
- **`review-panel.mjs` untouched.** Two already-exported symbols imported, nothing
  more. `lenses.json` byte-identical to `upstream/main` — confirmed by diff after the
  guard mutation was reverted.
- **No default output path, no default store root.** #675's precedent.
- **No `--snapshot-out` flag.** The snapshot is what the runner needs and the runner
  calls `buildConfig` in process; a CLI surface invented ahead of its only caller is
  a surface nobody tests.
- **No golden hash constant.**

## Verification

Measured on this machine, from the **committed tree** (`git archive <branch> | tar -x`),
Node 24.18.0, against `main` at `bb21ff953` (after #677 landed the `eval/` skeleton and
the recursive test lane).

- [x] **The `agent:tests` lane's own command — `cd scripts/agent && node --test
      '**/*.test.mjs'` — 1057 tests, 0 fail; 1002 on `main`.** +55, exactly the new
      suites. Baselines measured here rather than carried over:

      | tree | Agent SDK | root install | tests | pass | fail | skip |
      |---|---|---|---|---|---|---|
      | `main` | 0.3.217 | eslint 9.24.0 | 1002 | 1002 | 0 | 0 |
      | this branch | 0.3.217 | eslint 9.24.0 | **1057** | 1057 | 0 | 0 |

- [x] **These suites run in CI, and #677's own test proves it.** The lane was a flat
      `*.test.mjs` glob until #677 widened it to `'**/*.test.mjs'` — a flat glob matches
      nothing under `eval/`, so before that these 47 tests would have been written,
      passed locally and never run again. `eval/test-lane.test.mjs` reads the lane out
      of `verify-self.mjs` and asserts every suite under `eval/` is matched at every
      depth; it passes with both of these files present, and
      `path.matchesGlob` confirms each directly:

      ```
      lane: cd scripts/agent && node --test '**/*.test.mjs'
        eval/config-hash.test.mjs  -> MATCHED
        eval/config-build.test.mjs -> MATCHED
      ```

- [x] **The documented flat-glob command still passes and still says nothing about this
      PR.** `node --test "scripts/agent/*.test.mjs"` is 849/849 on both trees — it
      reaches no `eval/` suite at all. Recorded because quoting it as this PR's
      verification would have been a green number that covers none of the code.

- [x] **Decision 3's import costs zero skips.** This branch, lane glob, **no
      `node_modules` anywhere**: 1057 tests, 1051 pass, 0 fail, **6 skip** — the same 6
      as `main` (1 Agent SDK + 5 `lint-config.test.mjs`). The two `eval/config-*`
      suites alone with no `node_modules`: **55 tests, 55 pass, 0 skip.**

- [x] **It already earned its keep on a real change.** #671 reworded four lens rubrics
      (`correctness`, `security`, `design-fit`, `blast-radius`) between `82c7519d7` and
      `bb21ff953`, touching no field of `lenses.json`. The hash moved:

      ```
      82c7519d7  sha256:efafe9def96d0c21d66e9625982c7458db8297ffc10c97fe577eeca434c92a70
      bb21ff953  sha256:1c7853debf4edf92646d2299b0c924cb48cca89d6bb68b81648c57508a762f01
      ```

      Which is the point: a reworded rubric is a different reviewer, and nothing else
      in the repository would have said so.

- [x] **`npx eslint scripts` exits 0**, at the lockfile's pinned `eslint@9.24.0` /
      `@eslint/js@9.24.0` / `globals@16.0.0`.

- [x] **Both hash directions, every field.** A pair differing only in `scopeClasses`
      hashes **differently**; an omitted `scopeClasses` hashes the **same** as an
      explicit `FILE_CLASSES`. Same two for `effort` (absent ≡ `"high"`), `maxTurns`,
      `gating`, `needsIssueSpec` and `appliesWhen`.

      `samples` is asserted as a **property over 12 values × 12 values**: two
      manifests hash the same *exactly when* `sampleCountFor` would run the same
      number of samples. That is what makes the equivalence the panel's rather than
      this file's.

- [x] **Round trip against the real `lenses.json`, not a fixture.** `buildConfig` →
      `materializeLenses` → re-read: all 6 lenses, key set identical and every value
      `deepEqual`, and the rebuilt `config_hash` matches.

- [x] **The effort regression is proven closed end to end**, with the before/after
      quoted above: 5 lenses keep `medium`, `security` keeps **no `effort` key at
      all**, every `scopeClasses` survives. Preserving the absence matters as much as
      preserving the values — writing `"high"` out explicitly would change the
      manifest's bytes while claiming to reproduce it.

- [x] **The drift guard fires on the real file.** `cacheWarmupStrategy: "eager"`
      added to `lenses.json`:

      ```
      ✖ guard: every key in the real lenses.json is hashed or named cosmetic
        AssertionError: scripts/agent/lenses/lenses.json carries unclassified lens
        field(s): cacheWarmupStrategy. Add each to HASHED_LENS_FIELDS if it changes
        what a lens does, or to COSMETIC_LENS_FIELDS with the reason it does not.
      ```

      Reverted; 47/47 green and `lenses.json` byte-identical to `upstream/main`.

- [x] **26 mutations applied one at a time, 26 caught** — see below.

- [x] **The README no longer contradicts this change.** Its own stated completion
      condition, run:

      ```
      $ grep -n "config identity\|config_hash" scripts/agent/eval/README.md
      19:| `config-hash.mjs` | `config_hash` — the fingerprint of a lens **configuration** …
      ```

      One line, the new table row, and it asserts nothing is unbuilt. The remaining
      "not built yet" sentence names the runner, the arm adapters and the scorers,
      which is still true. No test reads this file, so the check is the grep.

### The mutations

The seven the plan named, plus twelve this PR owes for what it added, plus seven for the
review round. Each applied to a pristine file and reverted before the next.

| # | Mutation | Red | First message |
|---|---|---|---|
| 1 | restore the fork's `\|\| 2` samples default | 1 | `samples undefined vs 2.5: panel runs 2 vs 2, hash split them` |
| 2 | drop `scopeClasses` from `normalizeLens` | 2 | `two lenses reading different slices of the diff hashed identically` |
| 3 | drop `effort` from `normalizeLens` | 4 | `Expected "actual" to be strictly unequal` |
| 4 | drop `effort` on the way IN | 3 | `lens correctness: key set changed` |
| 5 | drop `scopeClasses` on the way OUT | 2 | `lens correctness: key set changed` |
| 6 | drop `effort` on the way OUT | 2 | `lens correctness: key set changed` |
| 7 | give `--out` a default path | 1 | `--out must not acquire a default output path` |
| 8 | drop `maxTurns` from `normalizeLens` | 2 | `Expected "actual" to be strictly unequal` |
| 9 | hash `gating` as a raw string | 1 | hash equality broke between `"advisory"` and `"blockign"` |
| 10 | drop the `appliesWhen` wildcard collapse | 1 | hash equality broke between `["**"]` and `["**","packages/**"]` |
| 11 | absent `effort` → a sentinel instead of `high` | 1 | `<unset> is not an SDK effort level` |
| 12 | re-hardcode the SDK version in the CLI | 1 | `'0.3.217' !== '9.9.9'` |
| 13 | drop the RANGE refusal | 1 | `Missing expected exception.` |
| 14 | make `captured_at` un-injectable | 1 | pinned time not honoured |
| 15 | stop validating `effort` on the write path | 1 | `Missing expected exception.` |
| 16 | narrow `buildConfig` to the seven-field allowlist | 4 | unknown field became `undefined` |
| 17 | narrow `materializeLenses` to the seven-field allowlist | 3 | unknown field became `undefined` |
| 18 | drop a field from `HASHED_LENS_FIELDS` | 2 | `review-panel.mjs carries unclassified lens field(s): maxTurns` |
| 19 | break the panel-source scan so it matches nothing | 1 | `the scan did not find \`lens.id\` in review-panel.mjs — the scan is broken, not the panel` |
| 20 | restore `localeCompare` in `canonicalConfig` | 1 | `lenses are not in code-unit order — a locale-sensitive comparator makes the hash machine-dependent` |
| 21 | drop the lens-id guard from `buildConfig` (read) | 1 | `Missing expected exception.` |
| 22 | drop it from `materializeLenses` (write) | 2 | `a rubric was written outside destDir` |
| 23 | let the id guard accept a separator | 2 | `id "a/b" was accepted` |
| 24 | re-hardcode `rubric_path` | 2 | `rubric_path is still the hardcoded default` |
| 25 | let `sdkVersion` fall back to `undefined` | 1 | `sdk_version vanished from the serialised manifest` |
| 26 | blind the destructuring half of the panel scan | 1 | `the scan missed \`effort\`` |

26 is the one that changed a design decision. It **survived** the first time: the panel
destructures no lens today, so blinding that branch of the scan broke nothing observable.
An untested branch is decoration, so the scan was extracted into a function and given a
fixture of every syntax a lens read can take — at which point 26 goes red. That fixture
then caught a bug in the scan itself, which had been capturing a rest element's LOCAL
name (`...restOfLens`) as though it were a manifest field.

19 and 11 are also worth noting. 19 is the #676 lesson made mechanical: a scan
that matches nothing fails loudly instead of passing vacuously. 11 shows the
`"high"` normalisation is anchored to `assertEffort`'s own level list rather than to
a string somebody typed.

## Not verified

- **That `high` is the SDK's runtime default, as opposed to its documented one.**
  Four independent upstream/SDK statements agree (decision 2) and no session was
  opened to observe it — that would cost money and prove one model's behaviour on one
  day. If it is ever measured otherwise, `DEFAULT_EFFORT` is one constant and
  mutation 11 shows the tests that hold it.
- **The pipeline half of identity.** `panelSha` exists and is recorded per capture;
  nothing yet **joins** it to a `config_hash`. That join is the runner's, and until it
  exists a `config_hash` alone does not license pooling.
