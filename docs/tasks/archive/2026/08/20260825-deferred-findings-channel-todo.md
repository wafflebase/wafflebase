# A machine-readable channel for the findings the gate defers

## The problem

A review round raises findings the gate does not act on: native `minor`/`nit`, and
`critical`/`major` demoted to `lane: "backlog"` by the novelty or surface gate. **Those
findings are durable but addressed to nobody.**

Durable, precisely:

- `verdict.json` keeps every finding a lens raised, demoted ones included, with the
  `lane` and `novelty` that explain each decision. `writeVerdict`'s comment says so:
  *"it is the record, not the gate."*
- `buildStageDetail` captures the raw per-sample findings before `unionSamples` and
  before `clusterFindings`, and the capture is **default ON**
  (`stageDetailCaptureEnabled` treats unset, empty and whitespace as enabled; only an
  explicit off-word disables it).

Addressed to nobody, equally precisely — the three channels that reach a tool:

| channel | carries deferred findings? | why not |
|---|---|---|
| check-run `output.text` | **no** | filtered to `critical\|major`, then `lane !== 'backlog'` |
| check-run `output.summary` | yes, but | `proseOnly` cuts at the first `\n### `, removing every finding section before the fixer sees it |
| next round's carry-forward | **no** | `prior-findings.mjs` reads `output.text` |

So the answer to *"what did this round decide not to act on, on this PR, in this
round"* is not available to anything on the pull request. It is recoverable only from
`verdict.json` inside the job, or from a diagnostic capture that a collector commits
to a different repository on its own schedule — and that capture is **pre-cluster**,
so one defect two samples both raised appears in it twice and never passed through
`annotateFindings`. Reconstructing the round's deferred finding *set* from it means
re-implementing clustering.

## The change

A second, advisory check run — `agent-deferred-findings` — written once per panel run
from the same `verdict.json` the gating channel reads.

- **`scripts/agent/deferred-findings.mjs`** — the population rule, the record
  projection, the bounded payload and the never-gates guard. Pure over its arguments;
  the fs reads live in the CLI `main`.
- **`.github/workflows/agent-review-panel.yml`** — two steps: one resolves the rubric
  generation stamp and runs the module, one creates the check run. Both
  `continue-on-error`.

**`output.text` is not widened, and must not be.** The comment above its two filters
names three consumers — the fixer checklist, the next round's carry-forward, and the
non-convergence detector — and the third is load-bearing: it needs a quantity that
**shrinks** as the fixer works, and a pile nobody is obliged to fix never shrinks.

### The record

`lens`, `file`, **`line`**, `severity`, `confidence`, `summary`, `evidence`, plus the
provenance: `lane` (**absent** for a native minor, `"backlog"` for a demoted
blocker), `noveltyOrigin` and `surfaceScope` where the panel stamped them.

**`line` comes from `findingLocation`, not from `finding.line`.** The gating
projection has no `line` at all; a record nobody can navigate to is a record nobody
reads. Using the panel's own resolver means this cannot drift from the location the
novelty and surface gates judged, and it recovers the line from a same-file evidence
citation when the lens omitted it — which that function's docblock measured as the
difference between 7 and 24 locatable findings out of 44.

### The rubric generation stamp

**One `panel_sha` per run**, and it is `git -C .trusted rev-parse HEAD`.

`severity` means whatever the rubric in force said it meant. Change a rubric so a
lens emits `minor` where it emitted `major`, and a record written afterwards is
indistinguishable from a native minor written before — not because per-record
provenance is missing, but because nothing says **which rubric generation** produced
it. An archive's value grows with time, so this cannot be added in version two: it
would describe none of the records that already matter.

Two candidates were rejected:

- **`rubric_sha256`** would be exact, and is **unreachable**. It is computed by the
  eval harness (`eval/config-build.mjs`), listed in `SNAPSHOT_ONLY_LENS_KEYS`, and
  absent from `lenses.json` — the panel never sees it.
- **The PR head sha** is available and **wrong**. `.trusted` is checked out at
  `ref: main`, so the head names a tree that need not contain these rubrics at all.

`.trusted`'s HEAD is the tree the rubrics actually came from. The same expression
already resolves `--panel-sha` for the capture, and the comment there already makes
this argument: *"A commit sha is always available and always correct, and a config
identity can be derived from it later."*

## Corrected while building

- **The channel is not a rescue from deletion.** The plan this came from said the
  non-blocking pile was "dropped, not deferred" with "no channel persisting them".
  That is wrong: `verdict.json` and the stage-detail capture both persist it, and the
  capture is default ON. The gap is a *product channel*, not durability. The PR is
  argued from the corrected framing.
- **Two deferred populations are reachable, not three.** `keepUnrefuted` runs before
  `writeVerdict`, so `lane: "discarded"` is absent from `verdict.json` by
  construction. That is the right population to be missing: a finding the verifier
  refuted is not deferred work.
- **No derived "why deferred" field is stored**, though one is the obvious
  convenience. `annotateFindings`' argument against giving non-blockers a lane
  applies verbatim — *"a second, redundant way to express the same thing, and any
  disagreement between the two would be a bug"*. And `severity.mjs::demotedBy`, which
  already answers "which gate demoted this", is **lossy by design**: it defaults to
  `relocated` for rows that never stamped `origin`. Storing its answer would bake a
  default into an archive as though it were a measurement. The record keeps the two
  primitives; a reader can apply that precedence.
- **The naming rule protects a consumer that exists today.** Six modules strip
  `^agent-review-`, and all are manifest-bound — but `set-state.mjs` enumerates *every*
  check run on the commit, filters `startsWith("agent-review-")`, and sets
  `lensBlocked` from what it finds. A name inside that namespace would feed an
  advisory record into PR state.
- **`panel-identity.test.mjs` does not force a classification here.** Its import walk
  runs outward from `review-panel.mjs`; a module the panel does not import is never
  reached, which is why `fix-brief.mjs` and `prior-findings.mjs` are in neither
  `PANEL_FILES` nor `NOT_PANEL_FILES`. Measured: adding an entry to
  `NOT_PANEL_FILES` also passes, because the "no dead entries" assertion tests
  `existsSync` rather than reachability. Neither list is correct on the documented
  domain of that set (*"local imports reachable from `PANEL_ENTRY`"*), so neither was
  edited.
- **Two review findings acted on, one skipped as measured-invalid.** The `!cancelled()` guard and
  the summary-tally fix below both came from review; the redaction finding did not survive
  verification. See *Review findings* at the end.
- **One mutation was ineffective, not uncaught.** A `panel_sha` override spread was
  inserted *above* the explicit `panel_sha:` key in the same object literal, so the
  later key overwrote it and behaviour was unchanged. It reported as SURVIVED, which
  reads as a missing test. Proven inert, then rewritten to mutate the expression
  itself, and caught.

## Fail directions

| part | on failure | why that is the safe side |
|---|---|---|
| `verdict.json` missing or unparseable, per lens | that lens contributes nothing; no throw | the same fail-quiet the gating writer applies to the same file. One malformed lens must not take the channel down |
| `lenses.json` unreadable | **refuses, exit 1** | the manifest is the trusted lens set. An empty record would read as *"this round deferred nothing"*, which is a lie with the same shape as a silent truncation |
| generation stamp unresolvable | `panel_sha: null` | a fabricated or partial stamp claims comparability across rubric generations. Unknown is a fact |
| unrecognised `severity` | treated as `major`, so **not** deferred unless explicitly demoted | inherits `normalizeSeverity`'s existing fail-safe. The flattering bug would be filing an unknown severity as non-blocking |
| record exceeds 60k | trailing records dropped, and `total`/`emitted`/`omitted` all reported | `buildChecklist`: *"A silent truncation reads as 'this is everything', which is how a fixer concludes it is done"* |
| budget too small for even one record | header-only payload, `omitted: total` | the floor is a truthful "I lost all of them", never an overflowing lie |
| name or conclusion not advisory | **throws** | the one hard failure. It guards a code change, not bad data, so it should redden CI rather than ship a quietly gating channel. The step is `continue-on-error`, so the blast radius is one missing advisory check |
| either new step fails | `continue-on-error: true` | an advisory channel must never be why a paid review round goes red |

## Explicit non-goals

- **Relaxing the `output.text` filters.** Three named consumers depend on that channel
  holding only gating findings, and one needs a quantity that shrinks.
- **Fixing the 60k trim in the gating channel**, which drops trailing findings and
  records nothing. Real, and a separate change: it alters the gating channel.
- **Consuming this channel.** Nothing reads it yet. It is one check run and a revert.
- **Rebuilding capture-side persistence.** It exists and is default ON.
- **Giving non-blocking findings a `lane`**, or any derived discriminator.
- **Any new permission.** `checks: write` was already held.
- Touching `clusterFindings`, any lens rubric, `severity.mjs`, `BLOCKING`, or the
  gate's decisions.

## Verification

Measured on one machine, both trees extracted with the same `node_modules` symlinked
into each, so a skip delta cannot be an environment artefact. Reported as
`rest + iso`, the way the lane produces them.

- [x] **`agent:tests` — 2517 + 57 = 2574 tests, 0 fail, 0 skip.** Baseline at
      `70e5be9ad30e`: **2475 + 57 = 2532, 0 fail, 0 skip.** Delta **+42** — 41 in the
      new test file, 1 added to `loop-status.test.mjs`.
- [x] **`npx eslint scripts` exit 0** (eslint 9.24.0, lockfile-pinned). Baseline also 0.
- [x] **Mutation testing: 37/37 caught by the specifically-named test**, tree restored
      byte-identical and re-runs clean. Covers the never-gates guard (5), the trim
      tally (6), the provenance fields (7), the generation stamp (4), the population
      rule (3), the fail directions (2), the new step's `retries` (1), and the review
      fixes (9). ⚠ Six patterns went stale when the review fixes moved their lines;
      the harness reported them as HARNESS ERROR rather than as passes, which is the
      property it exists to have.
- [x] **`eval/panel-identity.test.mjs` 8/8** and **`eval/test-lane.test.mjs` 8/8**
      unchanged — the two tests a new module and a new `github-script` step can break.
- [x] **Workflow structural diff:** triggers identical, job list identical, **every
      job's `permissions` identical**, every pre-existing `review-panel` step
      byte-identical, 2 steps added and 0 removed, `checks.create` 2 → 3,
      `checks.update` 2 → 2.
- [x] **YAML well-formedness** — parses, 8 jobs.
Two disclosures below are stated in the negative, so a tick would assert the
opposite of their text. They are plain bullets, the convention v0.6.5
established and v0.6.6 reused for `docs-sync`:

- **`actionlint` — NOT RUN. It is not installed on this machine.** The
  structural diff above is the substitute, not a claim of equivalence.
- **Never executed against a live panel run** (as of the v0.6.7 release pass).
  No PR has produced an `agent-deferred-findings` check run yet; the end-to-end
  test drives the CLI over a synthesised `.agent-review` tree, which exercises
  the module but not the workflow wiring or the API call.

## Review findings

Thirteen were raised across two rounds. **Ten are fixed; three are declined.**

### Fixed

| # | finding | fix |
|---|---|---|
| 1 | The summary mixed a full `total` with emitted-only counts, so on a trimmed round the non-blocking/demoted split and both tables were wrong — a demoted finding that fell off the tail read as non-blocking | `renderDeferredSummary` receives every record. Free: the tables are keyed by lens and severity, so the manifest bounds their size; only `text` needs the trim |
| 2 | Both steps ran under `always()`, publishing a cancelled, half-routed panel | `!cancelled()`, matching the sibling check-writer. Ordinary failures still publish |
| 3 | `isDeferred` tested severity before the lane, so a refuted **non-blocker** was admitted as deferred work | The lane is tested first, for every severity |
| 4 | `lane`/`noveltyOrigin`/`surfaceScope` were recorded from non-blockers, where they are **model output** — a lens could forge "the gate demoted a major" | Carried only for the severities the gate actually routes |
| 5 | `confidence` was the one model string copied unclipped, so one finding could evict the record | Clipped to 20 |
| 6 | The PARTIAL notice hard-coded `MAX_TEXT_CHARS` instead of the applied budget | States `maxChars` |
| 7 | The body clipped at `MAX_SUMMARY_CHARS` while `clip` appends an ellipsis, returning **60001** against a stated 60000 | Clips at `MAX_SUMMARY_CHARS - 1`. Found by the new clipping test, not by inspection |
| 8 | Unconditional `checks.create` left two contradictory runs after a panel re-run on one head sha | Updates an existing run when present |
| 9 | `loop-status.mjs` bucketed the run with CI's checks, and `neutral` is not red — so the dashboard could show green for a CI run that never happened | Excluded by name, with a test |
| 10 | CONTRIBUTING.md requires a design doc for a non-trivial change; this had only a task plan | `docs/design/harness-engineering.md` documents the channel, and its "ONLY as `agent-review-*` check runs" claim is no longer stale. `pnpm tasks:index` re-run |

A `file` fallback in `deferredRecord` was also removed as unreachable — `findingLocation`
returns null only when there is no usable file and no citation naming one.

### Declined

**Publishing `summary`/`evidence` without `redactSecrets`.** Two reasons, both measured:

- **Not a new boundary.** The existing per-lens runs publish the same two fields, from
  the same `verdict.json`, through the same API, in the same job. Neither
  `severity.mjs::renderSummaryMd` nor the `output.text` projection redacts;
  `review-panel.mjs` imports `redactSecrets` for infra error text only.
- 🔴 **It would corrupt the record.** Layer 4 masks whatever follows a field name like
  `token`, `secret` or `api_key`; layer 5 is an unconditional entropy catch-all. On
  seven realistic finding texts, **three came back mangled and all three were the
  security-relevant ones**:

  ```
  "password validation is skipped when …"  → "password <REDACTED> is skipped when …"
  "the secret: process.env.SIGNING_KEY …"  → "the secret: <REDACTED> …"
  "api_key handling in cli-auth.store.ts" → "api_key <REDACTED> in cli-auth.store.ts"
  ```

  It would gut every finding *about* credential handling, which is why the repository
  scopes that filter to transport errors rather than findings.

⚠ **The underlying concern is real and repo-wide** — a lens quoting a hardcoded secret
out of the diff publishes it today through six existing check runs. It wants a
shape-only redactor (layers 1–3) applied to all seven channels at once. Not this change.

**Advisory-lens findings are not captured.** Every lens in the manifest is
`gating: blocking`, so the population is empty today, and reaching it means plumbing
lens gating into a module that reads only `verdict.json`.

**The population rule is "a third copy of the gating filter."** Accurate, and not
fixable here: that filter is inline `github-script` with no exported function to derive
from. Recorded as a known coupling.

**`mark-ready.mjs` reads check runs unpaginated** (`per_page=100`). Pre-existing; this
adds one run per round to a 100-run first page.
