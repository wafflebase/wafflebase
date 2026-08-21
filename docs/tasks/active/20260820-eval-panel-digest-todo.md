# Give the review panel a content identity, and key cross-run scores by it

## The problem

`scripts/agent/eval/store.mjs` keyed every cross-run score by
`byConfigSegment(config_hash, corpus_version)`. `config-hash.mjs` says in its own header
what that key cannot see:

> This hashes the LENS COMPOSITION, not the panel's code. A new verifier stage or a
> changed gate leaves the hash identical.

So two runs of two different panels produced **one** directory name and **one** report
filename, and the second write overwrote the first with no diagnostic anywhere.

🔴 **`putScore`'s docblock asserted the opposite, and that is why nothing guarded it:**

> The one thing an overwrite cannot silently do is cross reviewers, and that is a property
> of the PATH rather than a check here … a score computed under a different reviewer lands
> in a different file by construction.

True of `per-run` scores, false of `cross-run` ones, and stated as the reason no check
existed. The evidence was written down, in the right file, next to the right code, and read
as reassurance instead of as a claim to check.

**Measured, on the data in the store today:**

| | |
|---|---|
| the ingested agent-PR run | one run id, 16 item envelopes |
| distinct `panel_sha` across those items | **16** |
| distinct panels by CONTENT | **5** |
| `config_hash` across all of them | **identical** — 5 reviewers, one key, one file |
| items running a panel that contains the post-freeze demotion (#881) | **1 of 16** — a gate the other fifteen do not have, deciding which findings block |

`panel_sha` is recorded already, and it is the right provenance and the wrong identity: it
separates panels that are byte-identical. #830 deleted `scripts/agent` outright and #850
returned it; the returned file is byte-for-byte the deleted one, and a commit-keyed
identity calls that two reviewers.

## The change

**`eval/panel-identity.mjs` (new).** `panel_digest` — `sha256:<64 hex>` over a manifest of
`<basename> <sha256 of contents>` lines, sorted by basename, over an explicitly declared
`PANEL_FILES`. Path-independent on purpose (#830/#850). Duplicate basenames, empty reads
and unreadable files all refuse.

- `PANEL_FILES` — ten modules, declared. The membership test is *does this file decide what
  the panel finds, or which lane a finding lands in?*
- `NOT_PANEL_FILES` — the seven local imports reachable from `review-panel.mjs` that are
  deliberately excluded, each with its reason as **data**, the same way
  `COSMETIC_CONFIG_FIELDS` holds its exclusions one level down.
- **The escape test** walks `review-panel.mjs`'s local imports and fails on anything in
  neither register. A new panel module cannot leave the identity quietly.
- A one-time operator CLI: `panel-identity.mjs --at <ref>` digests a past panel out of git,
  and `--allow-absent` names a declared file that does not exist there.

**Recorded, never recomputed.** `run.mjs` resolves the digest once (`resolvePanelDigest`,
mirroring `resolvePanelSha` including the `--panel-digest` override and the foreign-script
refusal) and writes it into `run.json` and every item envelope with
`panel_digest_source` and `panel_digest_version`. `validateRunEnvelope` requires it.
**No scorer derives a digest**: a historical panel is not reachable from a CI checkout, and
a recomputed identity changes when history is rewritten.

**The key.** `byConfigSegment(configHash, panelDigest, corpusVersion)` →
`<config-hash>__<panel-digest>__<corpus-version>`, threaded through `_scorePath`,
`putScore`, `getScore`, `comparisonIdFor`/`buildReport` and `writtenPaths`. Every part is
validated before the join and the join after it, as before.

**The refusal.** `resolvePanelDigest` reads the runs *and their items* and refuses a pool
that spans two panels, naming each digest and how many records carry it.
`--allow-mixed-panel` files it under `mixed` instead, and `putScore` then **requires** the
payload to carry `panel_digest: "mixed"` and a `panel_digests` list of at least two — so a
pooled number can never be read afterwards as one reviewer's.

**The seam.** The middle segment goes through `panelKeySegment(digest)`, which is the
identity map today. The panel-equivalence mechanism replaces that one function rather than
`byConfigSegment`'s call sites a second time. **Nothing of that mechanism is built here** —
no class ids, no declaration file, no `scope` field.

## Corrected while building

**1. The lenses do not belong in the panel digest, and including them would have hashed the
wrong copy.** The plan said to start from `review-panel.mjs` + `lenses/*.md` +
`lenses.json`. Two findings say otherwise:

- `config_hash` already covers the lenses **at content level**: `HASHED_LENS_FIELDS`
  includes `rubric_sha256`, which `config-build.mjs` sets to `contentHash(rubricText)`.
  Hashing the same bytes here is a second, weaker source of truth for a fact already
  recorded correctly — the exact argument `config-hash.mjs` uses to reject a
  hand-maintained `pipeline_version`.
- A replay's lenses come from the run's frozen config **snapshot**, materialised into a temp
  directory by `materializeLenses`, and `--lenses-dir` can point anywhere. The lens files
  next to `review-panel.mjs` are not necessarily the ones that ran.

So `config_hash` owns the CONFIGURATION and `panel_digest` owns the CODE, and each half is
owned once.

**2. The panel is materially more than `review-panel.mjs`, which the plan's evidence
understated.** Measured between the pilot's panel (`46da673dd`) and `main` (`5f2be616`),
**five of the ten declared panel files differ**: `review-panel.mjs`, `novelty.mjs`,
`severity.mjs`, `citation.mjs`, and `review-surface.mjs` (which does not exist at
`46da673dd` at all). A digest over `review-panel.mjs` alone would have called four of those
changes cosmetic.

⚠ **And a first draft of this argued it on the wrong file.** `severity.mjs` looks like the
behavioural one — it owns `BLOCKING` and `normalizeSeverity` — and it is not: pilot → main it
is **`+68 −0`** and touches **neither**, adding `demotedBy` and two demotion-section
renderers. It decides nothing differently. The genuinely behavioural change is
**`novelty.mjs`'s `findingLocation`, which switched from `parseCitation` to `parseCitations`**
— first citation to first *same-file* citation. Its own commit measures the effect: **17 of 44
blocking findings, 39%, had no location purely because of citation order.** Two files that
look alike from their names ranked opposite ways round, which is the reason the membership
test in `PANEL_FILES` is written as a question about behaviour rather than a list of
plausible-sounding modules.

**3. A panel's FILE SET changes, not only its contents.** `review-surface.mjs` arrived with
#881, so the declared set cannot be read at the pilot's commit. A missing declared file is
therefore a NAMED state in the manifest (`<name> absent`) rather than a refusal — but only
through `readPanelFiles`' explicit `allowAbsent` opt-in, because on the run path an
unreadable file is a broken checkout and a confident digest over it is the failure this
module exists to prevent. `absent` is six characters where a content hash is sixty-four, so
a panel missing a file and a panel containing any version of it are never one digest — and
that is also distinct from the file not being declared at all.

**4. `panel_digest_source` had no value for a reconstructed digest**, and this doc's own
migration section said so without closing it: *"`panel_digest_source` cannot distinguish the
two, because the envelopes carry no digest to source."* Naming a gap is not the same as
leaving it, so `PANEL_DIGEST_SOURCES` is now a closed three-value vocabulary — `files`
(hashed at run time, the only observation), `reconstructed` (stated: computed out of git after
the fact, or asserted by an operator) and `envelopes` (read back off the records a score
pools). `--panel-digest` sets `reconstructed` in both callers, and `putScore` refuses a
cross-run payload whose source is outside the vocabulary, so the field cannot be decorative.
That makes filing the pilot under its real panel digest both correct **and** honest: no field
claims an observation nobody made.

**5. A non-string `panel_digest` was being bucketed as absent.** Found by its own test: the
first `tallyPanelDigests` read "not a non-empty string" as absence, which put a
`panel_digest` of `7` in with the envelopes that predate the field. Absent is now exactly
`undefined`, `null` and blank; anything else present-and-malformed refuses.

**6. `--panel-digest` may not carry a named state.** The first wiring handed the driver's
resolution down verbatim, so a store of runs that record no digest would have passed
`--panel-digest not-recorded` to a child that refuses it — breaking the lane on every run in
the store. The flag now carries an identity only; `not-recorded` and `mixed` re-resolve in
the child from the same envelopes and the same `--allow-mixed-panel`. **Both survivors of
the first mutation run were this class of defect**, and both now have tests.

**7. The persist path's stamping was unreachable by any test.** Written inline inside
`report.mjs`'s `main`, it survived a mutation that hardcoded `panel_digest_source: "files"` —
which would have claimed every reconstructed digest was an observation, the exact dishonesty
correction 4 exists to prevent. Extracted as `withPanelStamp(payload, panel)` and tested
directly. The mutation harness also reported one **stale anchor** of its own, which is what
that check is for.

**8. `--panel-digest` could override a RECORDED panel, not just fill in for a missing one.**
Raised in review. The flag short-circuited the store in both callers, so a pool that really
did span two panels could be filed under one by passing a flag — the defect the cross-run key
exists to remove, reintroduced at the command line. `resolvePanelDigest` now takes `stated`
and honours it only where every record resolves to `not-recorded`, refusing otherwise with
what the records actually say. One rule in one place, because two copies of it is how the
second becomes the permissive one. Both rejection cases are tested: records that already agree
on a different panel, and a mixed pool (which `--allow-mixed-panel` does not rescue — `mixed`
is where a resolution lands, and a stated digest is a claim about one reviewer).

**9. The plan's caller list counts indirect callers.** `byConfigSegment` has **two** call
sites outside the store at `7dc81061` — `report.mjs:328` and `score-all.mjs:550` — not the
four listed; the other two are the `comparisonIdFor` calls those two flow through.

## Fail directions

| part | when it fails | why that is the safe way |
|---|---|---|
| `readPanelFiles` on the run path | a panel file is missing, unreadable or empty → **refuses** | a digest over nine of ten files is a confident identity for a panel that did not run. This is the state the repository was actually in between #830 and #850 |
| `panelManifest` | two files share a basename → **refuses** | one manifest line would silently absorb both, and one file's contents would stop identifying the panel — a digest that is quietly wrong, which is the one failure mode this module may not have |
| `resolvePanelDigest` | pooled records span two panels → **refuses**, naming each digest and its count | never picks the first and never the majority: 15-against-1 is still two panels, and a rule that resolved it would be a rule for hiding it |
| a record states nothing | → `not-recorded`, a NAMED path segment, and said on stderr | every envelope predating this field is here, and it is not a fault. It is not a safe pooling key either, which is why it is visible in the path rather than absent from it. Refusing instead would stop the lane on all of its own history |
| `panelKeySegment` | anything but a digest or those two states → **refuses** | validated, never sanitised — the same argument `configHashSegment` makes, and a third place a bad id could escape the store |
| a legacy two-part directory | neither read nor written nor deleted | this function can no longer produce that name, so old scores stay put and are simply not found. Matching them would pool the panels the key exists to separate |
| `putScore` cross-run | payload does not name the panel its path uses → **refuses** | a score file lifted out of git on its own must say which reviewer produced it; the directory is not part of the file |

## Explicit non-goals

- **The panel-equivalence mechanism.** Designed, and the next PR. This leaves
  `panelKeySegment` as the seam and stops.
- **The drift sentence in the rendered prose.** The report gains one row naming the panel's
  contents and one agreement axis; the narrative paragraph about *why* two panels differ is
  a follow-up.
- **`config_hash` and `CONFIG_HASH_VERSION`** are untouched. The panel is a second axis, not
  a redefinition of the first.
- **`review-panel.mjs`, `clusterFindings`, the lenses and the gate** are untouched. The
  benchmark only reads.
- **No existing stored data is rewritten.** The backfill is a script that PRINTS a digest;
  what to do with the pilot's already-filed scores is a decision, recorded below, not an
  action taken here.
- **The published report under the old two-part name is kept as a dated snapshot** —
  decided 2026-08-20 — neither renamed nor deleted. It is a record of a comparison whose
  reviewer it could not state.

## Verification

Both trees extracted from git, both with the same `node_modules` symlinks, measured once
each. Baseline is `upstream/main` at **`5f2be6169b0687652f9ae8e23d345ea6f84465fd`** (#914).

- [x] `agent:tests`, the lane's two invocations, reported as `rest + iso`:

  | | rest | iso (`eval/run.test.mjs`, private `TMPDIR`) | total |
  |---|---|---|---|
  | `upstream/main` `5f2be616` | 2337 pass · 0 fail · 1 skip | 56 pass · 0 fail | 2393 |
  | this branch | **2350 pass · 0 fail · 1 skip** | **57 pass · 0 fail** | **2407 (+14)** |

  The one skip is the Agent SDK's, in both trees. The five `lint-config.test.mjs` cases run
  in both, because both trees have a root `node_modules`.

- [x] `npx eslint scripts` — exit 0, with the lockfile-pinned `eslint@9.24.0`.
- [x] **Every new test mutation-tested: 32 of 32 mutations caught, all 32 by the
      specifically-named test.** The harness diffs each file after mutating and fails if
      unchanged, and each mutation declares which test must redden — being caught by a
      different test is reported as a harness finding, not a pass. It reported on itself
      twice, which is the point of those two checks: one stale anchor after a line it
      targeted was edited, and one genuine survivor (correction 7).
- [x] The escape test fails when a fake import is added to `review-panel.mjs` and passes
      when it is removed.
- [x] A mixed-panel cross-run write refuses by default and stamps the mixture under the
      opt-out.
- [x] The pilot's three legs score to **one** path.
- [x] Verified from the **committed** tree, not the working copy.

### Not verified, and why

- [ ] 🔴 **THE MIXTURE THIS PR EXISTS TO CATCH STAYS UNDETECTED UNTIL SOMETHING
      RE-RECORDS, and that is the honest headline.** Every envelope in the store predates
      `panel_digest`, so the live agent-PR run resolves to a single `not-recorded` bucket
      rather than to a mixture — the field the refusal reads was only just invented. So the
      5-panel pool is *not* refused today; it is filed under a path that says nobody
      recorded a panel, which is an improvement on a path that implied one and a long way
      short of the guard firing. The benefit is **deferred**, and it arrives one of two
      ways: a fresh replay (which records digests as it runs) or a backfill onto those 16
      items (a store write, and the human's call).
      **The plan's two done-conditions — "the pilot's three legs still score to one path"
      and "the agent-PR run refuses without the flag" — are jointly unsatisfiable on
      today's data**, because the two runs are indistinguishable on the digest axis until
      something records one. The refusal is exercised by tests and demonstrated end to end
      over recorded digests.
- [ ] **No replay was run.** `run.mjs`'s new resolution is covered by unit tests and by the
      end-to-end tests against the stub panel; no paid replay was bought, and this PR needs
      none.
- [ ] **The panel/not-panel split for `ask.mjs` and `redact.mjs` is a judgement call**, not
      a measurement. Both carry something that reaches a model or a reader
      (`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, `publicInfraReason`) and both are shared with every
      other agent script here, so including them would let a change made for the hunt lane
      re-partition the panel's populations. The reasons are in `NOT_PANEL_FILES` so the call
      can be revisited against evidence rather than re-argued from scratch.

## The migration decision, for the human

The pilot's panel, digested out of git at `46da673dd`:

```
panel_digest sha256:cbfa31bb55dbc6a98075e97f3c1b5ca60eaeb2f4770a0c049eed3b8c2fcdf770
             (review-surface.mjs absent — it did not exist at that commit)
upstream/main @ 5f2be616:
panel_digest sha256:0a694f26c5ba4226dce778e049706564f6a6737f2db5e0356d145fb4acd07ac5
```

**Recommended: re-score, do not hand-edit.** A pass is **210 core API calls** and no model
calls (`estimateApiCalls({items: 7, replicates: 3})` — `7 × (3×1 + 3) × 5`, three cross-run
API readers since `validity.mjs` was wired in), it exercises the new key end to end, and
hand-editing a path leaves the payload and the directory as two records that can disagree.

Run it as `score-all.mjs … --panel-digest sha256:cbfa31bb…`, which files the pilot under the
panel that actually produced it and stamps `panel_digest_source: "reconstructed"` — so the
attribution is recorded as computed-after-the-fact rather than observed. Without the flag it
lands under `not-recorded`, which is weaker and equally honest.

### 🔴 What a re-score moves, and what it does not

A previous draft of this said *"either way the numbers should not move"*. **That is not right
as written, and the reason it is mostly true is a better argument than the one it gave.**

**Scoring never runs the panel.** `score-all.mjs` has **zero** references to
`review-panel.mjs`, `novelty.mjs` or `reviewer.mjs` in its spawn path; the scorers read stored
envelopes. That — not `--frozen-sha` — is why most axes are stable.

**But one panel-side module is imported directly by the normalisation layer.**
`eval/finding-record.mjs:34` imports `findingLocation` from `../novelty.mjs` and calls it at
`:256`, and every cross-run scorer normalises through `finding-record`. `findingLocation`
changed between the pilot's panel and `main` (correction 2), so a re-score **does** execute
the new citation logic against stored findings:

| | moves on a re-score? |
|---|---|
| the `line` field → **localization figures** | **yes, upward** — the new reader finds a line where citation order previously hid one (39% of blocking findings on the agent PRs) |
| `finding_key`, defect classes, cross-arm matching | **no** |
| the 357 pair labels / `keys_moved` | **no** |

The second and third rows hold for a reason stated in the code itself —
`finding-record.mjs:252`: *"`line` is NOT part of the key — the panel's key has never had
one"*. `findingKey` is `` `${file}::${summary.toLowerCase().trim()}` `` (`finding-key.mjs:40`).
So **a re-score cannot invalidate the adjudicated labels**, and a reviewer who asks gets a
clean no.

That leaves this a hygiene fix on the pilot — with one figure legitimately moving, for a
reason unrelated to this PR — and a correctness fix on the live-ingested run.
