# The capture collector: get the stage-detail artifacts out before GitHub deletes them

A **new** document rather than a section appended to
`20260803-panel-stage-detail-capture-todo.md`. That one is about the *producer* —
what the panel writes and how it leaves the runner. This is the first *consumer*,
it lands two new modules and a workflow of its own, and its failure modes are
different in kind: the producer's worst day is a review with no notes, this one's
is a capture filed against the wrong pull request.

## The problem

#641 · #664 route a per-lens `stage-detail.json` out of both review panels as a
GitHub Actions artifact. **Nothing reads them.** Measured on the live API on
2026-08-05:

```
10 stage-detail artifacts · 51+ per-lens files · every one expires 2026-09-03 or 2026-09-04
```

`expires_at` is **fixed at upload**. #673 raising `retention-days` from 30 to 90
sets the clock for future uploads and moves nothing for an artifact that already
exists — the `retention-days` setting is honoured at upload time and never
retroactively, established separately when the rescue copies were taken. So no
configuration change saves these ten. The only fix is to copy them out, and this
is the one piece of the benchmark whose **cost rises with delay**: data not
collected is data gone.

The second problem is the one that decides the design. **A capture does not say
which pull request it is of, and the run that produced it cannot say either.**
Both producers are triggered by events — `workflow_run` and `issue_comment` —
that make GitHub execute the DEFAULT BRANCH's copy of the workflow, so every one
of the ten reports:

```
head_branch = "main"        pull_requests = []        referenced_workflows = []
```

That is a deliberate security property (the reviewer must never execute the
branch's code) and it is not going to change. #673 fixes it in the producer by
writing `meta.json` inside the artifact, and **merged at 2026-08-05T05:05:57Z**.
It only fixes captures written AFTER it, so all ten that exist today are still
unattributable and this collector's honest first result is to refuse every one
of them. The first collectable capture is the next review that runs.

## The change

- [x] `scripts/agent/collect-captures.mjs` — pure decisions, injected side
      effects. `parseMeta`, `keyFor`, `planCollection`, `safeEntries`,
      `summarize`, `walkArtifacts`, `expiryReport`, `runIdsFromKeys` are all
      pure; only the artifact download and the file write touch the world, and
      both arrive as arguments.
- [x] `scripts/agent/capture-store.mjs` — `hasCapture`, `putCapture`,
      `listCaptures` over a root directory. **Three methods, and the narrowness
      is the point:** this is the seam S3 drops into later and the surface PR 3
      extends, so it is a module rather than `writeFileSync` calls scattered
      through the collector.
- [x] `.github/workflows/capture-collect.yml` — `workflow_run` on both producers,
      plus a nightly sweep and a manual button. Its own `permissions:` are
      `{actions: read, contents: read}` and **no write scope of any kind on this
      repository**; the write goes to a different repo through a fine-grained
      token. It collects, commits, and then prints the still-uncollected count
      whether or not that count is zero.
- [x] The key scheme, following the S3 design's §7 so a migration is a path
      transform rather than a rewrite:
      `stage-detail/channel=<c>/pr=<n>/sha=<8hex>/run=<id>/attempt=<n>/<lens>.json`
- [x] 77 tests across `collect-captures.test.mjs` (67) and
      `capture-store.test.mjs` (10), every one mutation-tested (below).
- [x] **`--root` is required and has NO default**, and neither does
      `createCaptureStore`. This PR adds no data directory to this repository at
      all; see *Where it runs*.

### Where it runs, and why not where the design said

The S3 design's Option C is a `workflow_run`-triggered job that uploads to a
bucket, and there is no bucket — no AWS account, no IAM role, no OIDC trust
policy. Spec §8's interim answer was a folder in this repository, and that runs
into two things at once. **A job that writes here needs `contents: write`**,
which is the exact boundary #641 refused to cross for this subsystem. And **git
history is permanent** — data committed while the storage question is still open
could never be taken back out without a history rewrite, so "collect into
`wafflebase` for now" is not a reversible interim, it is the decision.

So the store lives in the separate eval repo (`dlgpdmsly2/wafflebase-agent-eval`:
public, already carrying the corpus, labels, runs and scores), `--root` names it
explicitly, and **this PR adds no data directory here.** The key scheme is
unchanged, so an eventual `aws s3 sync` is the whole migration.

**The write capability is not in this workflow's permissions.** It is in
`secrets.EVAL_STORE_TOKEN`, a fine-grained PAT scoped to exactly one other
repository with `Contents: read and write` and nothing else. So:

| | value |
|---|---|
| this workflow's `permissions:` | `actions: read`, `contents: read` |
| what `GITHUB_TOKEN` can write here | nothing — unchanged by this PR |
| what the scoped token can reach | one public data repo, contents only |
| blast radius of the secret leaking | that repo's contents, recoverable from its own history |

That distinction is the reason a collector may run in CI at all. #641's objection
was to widening what the review subsystem can do **to this repository**, and this
widens nothing: a job that writes somewhere else with a credential that cannot
reach `wafflebase` does not cross that line. A test asserts the permissions block
has no write scope, that the store checkout names the other repository, and that
the scoped token is not referenced anywhere before it.

An earlier draft of this PR had the collector run on a human's laptop with a
read-only warning job in CI, on the assumption that no secret could be added to
`wafflebase`. That assumption was wrong — a maintainer can add one — and the
laptop version was strictly worse: "a human remembers to run a script" is the
same class of failure as everything else this subsystem has shipped.

When S3 arrives this becomes Option C as designed: the two checkout steps and the
commit step collapse into `id-token: write` plus a PUT, the token secret
disappears, and the store gains a second implementation behind the same three
methods.

### The invariants, and where each one lives

| | invariant | where |
|---|---|---|
| A | keys are assembled only from validated primitives | `keyFor` re-validates every component and asserts the whole key against a grammar |
| B | the key contains `run` and `attempt`, so every write is idempotent | the key template; `#648`'s two rounds are the test |
| C | "already there" is success | `putCapture` → `"present"` |
| D | per-artifact and per-file isolation | every failure in `prepareArtifact` is a `return`, never a throw |
| E | attribution is all-or-nothing and never inferred | no `meta.json` → skip, loudly, exit 1 |
| F | bounded work with loud truncation | three caps, each naming exactly what it dropped, each turning the exit code red |

## Corrected while building

- **The design's §7 key scheme and its own invariant B disagree.** §7's example
  key is `channel=/pr=/sha=/run=/meta.json`; §9.1 B says the key contains "`run`
  and `attempt`". Settled as a separate `attempt=` component after `run=`, which
  keeps the Athena-style `key=value` partitioning the section chose it for.
  `sha=` keeps §7's 8-character prefix: `run=` already makes the key unique and
  the full sha is in the stored `meta.json`.
- **The expiry warning cannot ask "which PR is this artifact for" — and does not
  need to.** The obvious implementation downloads each artifact to read
  `meta.json`, which would need far more than a read-only job should do. It is
  unnecessary: invariant B put the producing `runId` in every key, and the
  artifact LIST carries `workflow_run.id`. So "is this collected?" is two
  listings and a set membership, with no download and no attribution guess. The
  invariant that exists for idempotence turned out to be what makes the monitor
  cheap.
- **`.part-` debris would have reported a crashed write as collected.** The store
  writes to a temp file and renames, because `writeFileSync(key, …, "wx")` that
  fails part-way leaves a truncated file AT the key that write-once will then
  never replace — this subsystem's signature failure rebuilt inside the module
  meant to prevent it. But the first version of `listCaptures` returned the
  `.part-` leftovers as keys, and `runIdsFromKeys` reads `run=` out of a key by
  regex, so an abandoned temp file would have marked its run collected in the
  expiry report. `listCaptures` now filters them.
- **`meta.json` is written LAST, not first.** The writes are separate operations
  and a crash can land between any two. With `meta.json` first, an interrupted
  run leaves an attributed capture holding some or none of its lens files, and
  nothing distinguishes that from a review that genuinely produced fewer. Written
  last, its presence means "complete as collected" — the same rule the producer
  holds on the way out, where #673 writes no `meta.json` unless a lens captured.
- **The artifact name is not a literal, and the first version of the test that
  reads it out of the workflows found zero producers.** #673 shipped
  `name: review-panel-stage-detail-pr-${{ steps.pr.outputs.number }}`, and a
  `${{ }}` expression contains SPACES; the parser stopped at the first one. The
  collector was already correct — it matches by PREFIX precisely because the
  suffix is a runtime value — but a test that only recognised literal names
  would have gone quiet on exactly the change it exists to watch. Caught by
  rebasing onto `main` an hour after #673 landed.
- **The store defaulted to a path inside this repository, and that default had
  to go rather than be updated.** The first draft had
  `DEFAULT_CAPTURE_ROOT = scripts/agent/eval/captures`, following spec §8. Once
  the store moved out, the obvious fix was to repoint the default — but the
  failure mode is asymmetric in a way that rules a default out entirely: one
  `--write` with a forgotten `--root` commits capture data into whichever repo
  the code happens to sit in, **permanently**, because no later `git rm` shrinks
  anyone's clone. A wrong default is silent and irreversible; a missing flag is
  loud and free. So `createCaptureStore` refuses a root it was not given, the CLI
  refuses before it makes a single API call, and there is no default anywhere.
- **`git add` on a missing path is FATAL, not a no-op — the first run would have
  gone red on a normal day.** The commit step originally ran `git add captures`
  straight out. Measured: on a path that does not exist that is exit **128**
  (*"pathspec 'captures' did not match any files"*), and the eval repo has no
  `captures/` yet. So the very first run — and every later run that collected
  nothing into a store where the directory was missing — would have failed the
  step and painted the job red with nothing wrong. An always-red job is one
  nobody reads, which is the failure this subsystem keeps shipping. `mkdir -p`
  first; an empty directory adds cleanly and the existing guard then takes the
  "nothing to commit" path.
- **A failed `Collect` step would have discarded everything it DID collect.**
  Found in review. The collector exits non-zero on any loud skip — the monitor
  working as designed, and the normal outcome on any run that meets one
  unattributable capture. But a failed step skips every later step by default, so
  a run that collected five captures and refused a sixth would have written all
  five into the working tree and committed none: loud partial success discarded by
  its own alarm. Both later steps now carry `if: ${{ !cancelled() }}`, the job
  still ends red because `Collect` still failed, and a test walks the step list to
  pin that every step after `Collect` carries the condition.
- **`--warn-days` went through a bare `Number()`.** So `--warn-days abc` was
  `NaN`, every `daysLeft <= NaN` was false, nothing was ever urgent, and the job
  exited 0 printing "0 within NaN day(s)". A typo in the threshold silently turned
  the warning off and reported success. Now validated like `--days` and `--limit`,
  as a usage error before any request is made.
- **`walk()`'s comment described behaviour the code did not have.** It said "one
  directory that cannot be read costs those keys and nothing else" and then
  rethrew, aborting the whole listing. Split: an unreadable ROOT propagates (a
  store you cannot read must not report as empty, or the collector re-collects
  everything into a directory it also cannot write), an unreadable SUBDIRECTORY
  costs its own keys.
- **Planting the REAL temp filename in a test found a real bug.** The write-once
  test planted `.part-99999`, a literal it invented, so it proved nothing about
  the producer's format. Using `.part-${process.pid}` — the name this process's
  own `putCapture` would choose — made the `wx` open return `EEXIST`: a stale temp
  file from an earlier run whose pid the OS recycled made that key unwritable for
  a whole run. `putCapture` now clears its own `.part-<pid>` first, which is
  provably safe because only one live process holds a given pid.
- **The plan called for "nine captures". There are ten.** A tenth arrived at
  `2026-08-05T03:06:40Z` (run `30971057563`, one lens, 369 bytes) while this was
  being written, and it is **not** in the rescued local copies. The count is a
  moving target, which is itself the argument for the scheduled warning.
- **A first attempt duplicated `capture-meta.mjs`'s constants with nothing
  holding them together.** #673 was unmerged when this was written, so the
  collector could not import it —
  and re-deriving a rule instead of reusing it is exactly how the upload glob
  came to match no `meta.json` at all. The substitute: a test that imports
  `capture-meta.mjs` **if the file exists**, asserts the schema string, the file
  name and the channel list all match, and runs the producer's own
  `buildCaptureMeta` output through the consumer's `parseMeta`. **#673 then
  merged mid-build and the workaround became unnecessary**: the three constants
  are now imported from `capture-meta.mjs`, so they have one definition and
  cannot drift, and the cross-check test became a round-trip — the producer's
  real `buildCaptureMeta` output goes into `parseMeta` and out through `keyFor`,
  for both channels. The VALIDATORS stay separate on purpose: a consumer reusing
  the producer's validator cannot detect a producer that validates wrongly, and
  this one also has to accept a hand-written backfill `meta.json` that never went
  through `buildCaptureMeta`.

## Fail directions

| path | on doubt | why |
|---|---|---|
| `parseMeta` | **throws**, naming the field and the value | mirrors the producer's rule. Partial trust has no shape here: a capture that is "valid except for `baseSha`" is one whose provenance cannot be relied on, and the corpus is the thing being protected |
| `keyFor` | **throws** | it is the function that concatenates. A `pr` of `../../..` writes outside the store, and `meta.json` travels out of a runner that processed untrusted branch content |
| no `meta.json` | **skip the capture, exit 1** | attribution is never inferred. The `lensFiles` inside a capture identify a PR's changed-file set almost uniquely — a human used exactly that to attribute seven of the ten by hand — and the collector still may not. A capture filed against the wrong PR corrupts the corpus in a way no later check would notice; a missing one is visible |
| one bad artifact | skipped; the batch continues | a batch that fails whole on the first bad capture collects nothing on the day one producer regresses |
| one bad lens file | dropped; its siblings are kept | `writeStageDetail` swallows its own errors by design, so a truncated file is genuinely possible and must cost one lens, not six |
| a hostile zip entry (`../`, absolute, NUL) | the **whole artifact** is refused | a zip carrying `../../etc/passwd` is not a capture with a typo. Nothing else in it is trustworthy either |
| a cap is hit | the drop is named — count, reason, ids, date range — and the run goes **red** | silent truncation reads as "everything was collected". It is the trap that hid the original capture bug for five rounds |
| an artifact page fails to load | keep what is in hand, report the walk as partial, exit 1 | fails toward fewer records. The artifacts live 30–90 days, so a retry costs a delay and not the data — but a run that saw half the window must not read as a run that saw all of it |
| `putCapture` throws mid-batch | that file is recorded as dropped; the rest continue | a full disk is not a reason to abandon the artifacts after it. The artifacts have a deadline and the disk does not |
| the key already exists | `"present"`, counted as success | the key names one execution, so the bytes never legitimately differ. This is what makes a retry, a race and a re-scan the same operation |
| the store does not exist yet | `[]` and `false` | first run |
| **the collector is invoked with no flags** | prints what it would do and writes **nothing** | `--write` is required to touch the store, matching `harvest.mjs`'s `--append`. An accidental invocation is a report |

## Explicit non-goals

**No S3, no AWS, no OIDC, no credential of any kind.** Spec §8 puts the store in
the repository and makes S3 a later migration behind these three store methods.

**No `contents: write` on this repository, and none wanted.** The collector job
writes to a different repo with a token that cannot reach this one. A test
asserts no write scope of any kind appears in that workflow file.

**No backfill of the ten existing captures.** They need a hand-written `meta.json`
each and human attribution, marked `"provenance": "manual-backfill"` — a data
change, reviewable on its own terms, not something to smuggle in beside the code
that will consume it. They are already safe in a local copy of record; the
GitHub artifacts are not the only copies.

**No attribution inference, ever.** Not from `lensFiles`, not from timestamps, not
from run order, not from the PR number in the artifact NAME. A human may do this.
The collector may not.

**Nothing reads inside a `stage-detail.json`.** It is parsed to check that it
parses and the result is discarded. No scoring, no normalising, no adapters —
that is PR 5 onward, and a collector that understood its payload would have to be
updated every time the payload changed.

**No change to either producer.** #673 owns those.

**No fourth store method.** PR 3 grows this surface; a `getCapture` written now
would be an untested method the S3 implementation must also satisfy, for a caller
that does not exist.

**No alerting, no dashboard, no database.** A red X in the Actions tab is the
whole escalation path. If that turns out to be insufficient, it is a good problem
and a later PR.

## Verification

Measured on `upstream/main` `e5de00ae9`, with the Agent SDK **installed** in
`scripts/agent/node_modules` and eslint installed at the root (both matter: the
skip count moves with the SDK, and `lint-config.test.mjs` skips without eslint —
in a tree with neither, the same baseline reports 5 skipped).

- [x] **836 tests, 0 fail, 0 skipped** — against a measured baseline of **759,
      0 fail, 0 skipped** on `upstream/main` `5f9b7f86e`, measured in a clean
      checkout of that commit. +77 from this PR. (`main` moved twice during the
      build — the same pair read 770/693 before #673 and 785/708 after it. The
      delta is the number that means anything; the totals are a moving target.)
- [x] `eslint@9.24.0 scripts` — exit **0**. (Baseline also 0. A bare `npx eslint`
      resolves 10.8.0 and flags pre-existing code; that is version drift.)
- [x] **A real read-only dry run against the live API**, `--since 2026-08-01`:

      collect-captures: read 4 artifact page(s), 400 artifact(s) (stopped early at --since).
      collect-captures: 10 capture artifact(s) in the window, 390 other artifact(s) ignored.
      collect-captures: skipped review-panel-stage-detail (8916580029) — no-meta: 1 lens file(s) present but no meta.json
      … ×10 …
      collect-captures: would collect 0 capture(s), 0 file(s), 0 KB · 0 already present · 10 skipped (10 no-meta) · 10 capture artifact(s) scanned
      collect-captures: PRINT-ONLY — pass --write to copy these into …
      exit 1

      Ten found, ten refused, exit 1, and no store directory created. **A run
      that collected something here would be a run that guessed.**
- [x] **The expiry command against the live API**, `--days 120 --warn-days 14`:

      capture-expiry: walked 33 artifact page(s), 3300 artifact(s), stopped early at the window edge · 0 file(s) already in the store
      capture-expiry: 10 stage-detail artifact(s) known · 0 already collected · 10 UNCOLLECTED · 0 expired uncollected
      capture-expiry: soonest uncollected expiry in 29 day(s); 0 within 14 day(s).
      exit 0

      Green today and red from 2026-08-20, which is the point. Re-run with
      `--warn-days 40` it names all ten with their dates and exits 1.
- [x] **Pagination early-stop, proved twice.** In a test, against a fake
      3809-item newest-first sequence: 3 pages read, page 4 never requested. And
      live: 4 pages for a 4-day window instead of the 33–39 a full `--paginate`
      costs.
- [x] **Every new test mutation-tested — 19 mutations, 19 caught.** Table below.
- [x] The collector workflow's `permissions:` block, quoted from the file:

      permissions:
        actions: read # list and download the artifacts
        contents: read # check out the collector

      No `write` appears anywhere in the file's YAML — not at job level, not
      `id-token`. A test asserts the exact block, the absence of `: write`
      anywhere, that the store checkout names `dlgpdmsly2/wafflebase-agent-eval`,
      and that `secrets.EVAL_STORE_TOKEN` appears nowhere before that checkout.
- [x] Verified from the **committed tree** (`git archive <branch> | tar -x`), not
      the working copy.

### The mutations

Nineteen, each breaking the code a test claims to protect. The harness refuses to count a
replacement that landed on a comment line — #673's mutation run reported a false
survivor for exactly that reason.

| # | mutation | first test to go red |
|---|---|---|
| 1 | `parseMeta`: `pr` validated with a bare `Number()` | `parseMeta: REFUSES every field…` — *Missing expected exception: accepted {"pr":"../../etc"}* |
| 2 | `keyFor`: take `pr` straight from the object | `keyFor: REFUSES to build a key from unvalidated input` |
| 3 | drop `runId` from the key (grammar **and** template) | `keyFor: two gating rounds of ONE pull request do not collide` — *Expected "actual" to be strictly unequal to `…/pr=648/sha=c18b6abb/attempt=1/correctness.json`* |
| 4 | `path-traversal` no longer counts as hostile | `safeEntries: a traversal that ALSO ends in a slash is hostile` |
| 4b | whitelist any directory depth before `stage-detail.json` | `safeEntries: rejects traversal, absolute paths…` |
| 4c | store: drop the `..` segment check | `a ".." segment is refused AS TRAVERSAL, not as a bad character` |
| 5 | `summarize`: a cap-drop no longer reddens the exit code | `planCollection: the cap reports EXACTLY what it dropped` — *a cap that dropped data must go red* |
| 5b | `planCollection`: apply the cap, record nothing about it | same test, on the dropped count |
| 6 | `prepareArtifact`: accept a capture with no `meta.json` | `the nine real captures: ALL nine are skipped…` |
| 7 | `no-meta` removed from the loud-skip set | `summarize: a no-meta skip goes RED` |
| 8 | `putCapture`: drop the write-once check | `putCapture is WRITE-ONCE…` |
| 9 | `walkArtifacts`: remove the `--since` early stop | `walkArtifacts: STOPS early against a 3809-artifact list` |
| 10 | `expiryReport`: an unknown expiry is not urgent | `expiryReport: an unreadable expiry counts as URGENT` |
| 11 | the workflow: `contents: read` → `contents: write` | `the collector workflow has NO write scope on THIS repository` |
| 11b | the workflow: drop `repository:` so the store checkout is THIS repo | `the collector workflow has NO write scope on THIS repository` |
| 11c | the workflow: swap the scoped secret for `github.token` | same |
| 11d | the workflow: aim `--root` at a path inside this repo | same — *did not match /--root \.capture-store\/captures/*. Verified by hand rather than by the harness: the string appears twice (collect and expiry steps) and the harness refuses a pattern that is not unique |
| 11e | the workflow: drop `if: !cancelled()` from the commit step | `the steps after Collect run even when Collect FAILS` |
| 12 | restore a default root pointing into this repo | `there is NO default root — a store must be told where it is` — *Missing expected exception: createCaptureStore accepted undefined as a root* |

Mutation 4c was the interesting one: it **survived** the first run. The store's
segment grammar already rejects `..` (a segment must start with `[A-Za-z0-9]`),
so deleting the explicit check changed nothing about safety — only the error
message, from *"escapes the store"* to *"is not `[A-Za-z0-9][A-Za-z0-9._=-]*`"*.
A reader given the second message goes looking for a character-set bug. The check
is redundant for safety and load-bearing for the log line, and there is now a
test on the text.

## Not verified

Every item here was resolved by the first live run — see the section after it.

- [x] **The collector has never collected anything.** It has now: run
      `30988338870`, 11 files for #674 and #672, each with a producer-written
      `meta.json` that passed `parseMeta`.
- [x] **No recovery sweep wider than 7 days.** `workflow_dispatch` now takes a
      `days` input (below), so §9.2's wider window is a button rather than a pull
      request.
- [x] **The workflow has never run.** A maintainer added `EVAL_STORE_TOKEN`; the
      three-level `workflow_run` chain fired on its own, first try.
- [x] **The commit-and-push step is untested end to end.** It ran, pushed 11
      files, and did so on a run whose collect step had FAILED — which is how the
      `if: !cancelled()` condition turned out to be load-bearing on day one.
- [x] **`gh api …/zip` and `unzip -p` on `ubuntu-latest`.** Both exercised by the
      same run; 12 artifacts listed, 2 downloaded and unpacked.

## After the first live run: red that means something

The first run collected 11 real files and **reported failure**, because the ten
pre-#673 captures were inside the seven-day window and each was a loud `no-meta`
skip. Correct by the rule as written, and wrong as a signal: the job would have
stayed red for about a week for a reason that is neither news nor actionable, and
**an always-red job is one nobody reads.** That is this subsystem's failure mode,
not a cosmetic complaint — five rounds of uploads were lost to a "No files were
found" line nobody read, and the novelty gate printed `OFF` for weeks.

Two things were being conflated under one reason string:

- a capture from **before** #673 has no `meta.json` because none was written —
  expected, and not the collector's problem to solve;
- a capture from **after** #673 has none because a producer regressed — news.

Split into `no-meta-legacy` (counted, never collected, **not** an alarm) and
`no-meta` (unchanged, loud).

**The discriminator is the artifact NAME, not a cutoff date.** #673 made two
changes in one commit: it started writing `meta.json`, and it renamed the artifact
from the bare stem to `-pr-<n>`. Both live in the same upload step of the same
file, so the name is a direct reading of *which producer ran* rather than a proxy
for *when* it ran — and unlike a timestamp it cannot be wrong about a run that was
in flight when #673 merged, because such a run uploads the old name by
construction. The set cannot grow: neither producer can emit the bare name any
more, and a test reads the real `name:` lines and pins that. Any other name,
including a `-pr-` with an empty expansion, stays loud.

Measured 2026-08-05, and the two readings agree today: all ten bare-named
artifacts predate the merge at 05:05:57Z, both `-pr-` named ones follow it. Only
one of the two readings stays correct without maintenance.

- [x] **Live dry run, exit 0**, with nothing quietly collected:

      collect-captures: skipped review-panel-stage-detail (8916035419) — no-meta-legacy: 6 lens file(s), uploaded before #673 added meta.json — recoverable only by hand, and only until it expires
      … ×10 …
      collect-captures: would collect 2 capture(s), 11 file(s), 124 KB · 0 already present · 10 skipped (10 no-meta-legacy) · 12 capture artifact(s) scanned
      exit 0

- [x] **Quiet is not invisible.** The same ten are still named individually in the
      log, still counted by reason in the summary line, and the expiry report still
      lists them: `12 stage-detail artifact(s) known · 0 already collected · 12
      UNCOLLECTED`. They keep their own deadline (2026-09-03/04) and it is a
      human's to meet.

Three smaller things, fixed while the file was open:

- **The trigger fired on producers that had done nothing.** `workflow_run` fires on
  `completed` regardless of conclusion, and three of the five runs between 08:16 and
  08:51 were triggered by a *skipped* on-demand panel — ~41 API pages and a runner
  minute each to collect zero. The job is now gated on
  `conclusion != 'skipped'`, and on `skipped` only: `failure` must still run,
  because a panel that crashed after four of six lenses captured four, and so must
  `cancelled`, where the upload may or may not have happened. The `event_name` half
  of the condition is what keeps `schedule` and `workflow_dispatch` working, since
  neither has a `workflow_run` payload. A test pins the exact expression and asserts
  that `failure`, `cancelled` and `success` are **not** gated — gating too much
  loses captures silently, which is the failure mode this whole file exists to
  avoid.

- **`--days` is a `workflow_dispatch` input**, defaulting to `7` so all three
  triggers agree unless somebody deliberately disagrees. Passed by environment and
  quoted, never interpolated into the shell body; the collector validates it as a
  positive integer and exits 2 otherwise. This is what makes a capture that has
  aged out of the routine window recoverable without a merge — the ceremony was
  worst exactly when it was needed, since the reason a capture falls out of the
  window is usually that nobody noticed for a week.
- **The pushed-file count was off by one**, always. `git show --stat --oneline |
  tail -n +2 | wc -l` drops the subject line and then counts the trailing
  " N files changed" summary as a file: the first run said 12 for 11. Now counted
  from the index before the commit. The test **extracts the line from the workflow
  and runs it** against three staged files in a throwaway repo, rather than
  re-typing the command — the reason the bug shipped is that a shell one-liner in
  YAML had no test at all.

And one gap found by a reviewer's question rather than by a test:

- **Nothing pinned that this job never checks out the branch under review.** It
  was true and it was reasoned about, but the assertion was missing — and it is
  the property the whole permission model rests on, because the job holds a token
  that can write to another repository. `workflow_run` runs the default branch's
  copy and sets `GITHUB_SHA` to the default branch tip (measured: run
  `30988338870` reported `head_branch: main` and a `head_sha` identical to `main`
  while collecting #674's captures), and no step overrides it. Now asserted: no
  `ref:` anywhere, and none of `head_sha` / `head_branch` / `head_ref` /
  `pull_requests` may influence what is checked out. A second test rejects `${{ }}`
  inside any `run:` body — the general form of that bug, and the first version of
  it passed for the wrong reason because a whole-file `run:` regex matches inside
  `workflow_run:`.

- [x] **845 tests, 0 fail** (+6 from this follow-up; 1 skipped, which is
      `lint-config` in a tree without eslint at the root). `eslint@9.24.0 scripts`
      exit 0. **11 further mutations, 11 caught**: predicate widened to a prefix
      match; `no-meta-legacy` added back to the loud set; the ternary inverted;
      `--days` hardcoded; the input default dropped; an expression interpolated
      into a `run:` body; the off-by-one count restored; and `ref:
      ${{ …head_sha }}` added to the checkout.
