# Port the review-loop convergence work from yorkie-js-sdk

## The problem

yorkie-js-sdk#1426 spent twelve hours and seven panel rounds after the panel
had already approved it, and ended at `agent:blocked` with two fixer runs that
produced nothing. The harness defects behind that are shared: wafflebase's
`review-state.mjs` and `review-scope.mjs` were byte-identical to the js-sdk
copies before the fix, and `harness-engineering.md` already named the first
defect (a human `git merge main` flipped a lens verdict) without solving it.

js-sdk fixed them in two squash commits, with the design, the decisions and
every review fix recorded in its
`docs/tasks/active/20261001-harness-convergence-todo.md`:

- `898cd697` (#1428): carry an approval across a head whose PR diff is
  unchanged (patch-id fingerprint), reuse verdicts on an identical-head rerun,
  probe the fixer credential before the round is spent, page an infra-failed
  fix round with its cause.
- `bc591151` (#1432): show the tests a fix round removed to the next
  adjudicator, tell design-fit when it has no spec and cap scope findings,
  count clean→blocking escalations.

This task ports the harness parts (`scripts/agent/**`, `.github/workflows/agent-*`,
the maintainer-merge skill, the design doc) and skips the SDK source changes.

## Starting point (measured)

- Identical to js-sdk before #1428: `review-scope.mjs`, `review-state.mjs`,
  `review-state.test.mjs`. The patch applied there unchanged.
- Different, ported by hand: `fix-report(.test)`, `metrics(.test)`,
  `pick-fix-credential(.test)`, `rebuttal`, `review-panel(.test)`,
  `review-scope.test` (path fixtures only), `lenses/design-fit.md`, the
  maintainer-merge skill, and the four workflows.
- wafflebase already has `auth-smoke.mjs` with `classifyFailure`, the origin of
  js-sdk's probe classifier. Reused rather than copied.
- wafflebase has no trusted post-agent job: the panel's `fix` job and
  `agent-fix.yml`'s `fix` job run their reporting steps after the agent, where
  js-sdk runs them in a separate `fix-report` / `report` job.
- No overlap with `deferred-findings.mjs` or `finding-match.mjs`: neither
  carries verdicts across heads, records test removals, or counts escalations.

## Tasks

- [x] Worktree from `origin/main` (`a2051cfa7`); `npm ci` in `scripts/agent`,
      `pnpm install` at the root for lint. Baseline: 2654 pass, 0 fail.
- [x] Carry and reuse: apply the `review-state`/`review-scope` patch, copy
      `carry-verdicts`, `fingerprint.test`, `carry-wiring.test`; stamp `fp` in
      `review-panel.mjs`; wire the fingerprint, scope and carry steps in the
      panel; skip lens runs, deferred findings and the round comment on a carried
      round; label carried check titles; the rerun note; the merge skill caution.
- [x] Probe: `pick-fix-credential.mjs --probe` on `auth-smoke.mjs`'s vocabulary
      (new `classifyRefusal`); move the picker before the App token, the branch
      checkout and the install, with the SDK unpacked beside the staged scripts.
- [x] Infra page: copy `fix-outcome.mjs`; page from a new `fix-evidence` job;
      `stalled` stands down for it; `infra-wiring.test.mjs` rewritten for this
      layout.
- [x] Removal evidence: `test-removals.mjs` adapted to this repo's runners; join
      in `fix-report.mjs`; render before the fence in `rebuttal.mjs`;
      `withRoundEvidence` in `review-panel.mjs`; post from `fix-evidence` in both
      fixer workflows; the keep-it-failing rule in both fixer prompts; add the
      module to the panel identity.
- [x] No-spec design-fit: `NO_SPEC_NOTE`, `--issue-state`, the rubric section,
      both issue fetches record a failed read.
- [x] Escalations in `detectFlips` and the effort summary.
- [x] `harness-engineering.md` Phase 33; this task pair; `pnpm tasks:index`.
- [x] Full `scripts/agent` suite, `lint:scripts`, `verify:doc-index`,
      `verify:doc-links`, `verify:entropy`.
- [ ] Watch the first real PR through a carry, a reuse, a live probe and (when
      one happens) an infra page; record what it shows here.
- [ ] Follow-up, separate change: move the `fix` jobs' existing post-agent
      reporting steps into a trusted job, as yorkie-js-sdk did, and adopt its
      "nothing after the agent but the handoff" structural test.

## Review

### What was ported, and how it differs from yorkie-js-sdk

Byte-identical to js-sdk `origin/main`: `review-state.mjs`,
`review-state.test.mjs`, `review-scope.mjs`, `carry-verdicts.mjs` (+ test),
`fingerprint.test.mjs`, `fix-outcome.test.mjs`, `carry-wiring.test.mjs`.
`fix-outcome.mjs` differs by one header comment naming the job it runs in.
`#1426` inside them is js-sdk's PR; every wafflebase-authored line says
`yorkie-js-sdk#1426`. Keeping them identical is deliberate: the next sync is a
diff, not a re-port.

Intended divergences:

1. **Post-agent work runs in a new `fix-evidence` job, not after the agent.**
   js-sdk has a trusted `fix-report` job for everything after the agent; here the
   `fix` jobs still run their reporting steps on the agent's runner. The infra
   page latches the PR and the removal record is trusted by the adjudicator, so
   neither joins those steps. Each fixer workflow gets a `fix-evidence` job on a
   fresh runner, from trusted main, reading the head through the API, with only
   the GITHUB_TOKEN. Moving the existing steps is out of scope (follow-up above).
2. **`stalled` does not page when `fix-evidence` fails on its own.** js-sdk pages
   on `fix-report` failing because that job carries the no-commit page and the
   fix report itself. Here it carries evidence and one page. A failed fixer that
   `fix-evidence` did not page (it failed, was skipped, or found nothing to call
   infra) still reaches `stalled` through `needs.fix.result == 'failure'`, so
   nothing is lost and a checkout hiccup cannot latch a PR that pushed.
3. **`advanced` is tri-state in the panel's `fix-evidence`.** js-sdk writes
   `advanced=false` when the head cannot be read; here it writes nothing, and
   the infra page requires `advanced == 'false'`, which now means "both heads
   read and equal". js-sdk gets the same result from `steps.after.outcome`, but
   its no-commit page relies on the binary value, which this job does not have.
4. **The probe classifier is `auth-smoke.mjs::classifyRefusal`**, a narrow form
   next to the pre-arm check's `classifyFailure`, sharing its AUTH list and
   `SESSION_LIMIT_RE`. js-sdk copied a narrowed list into the picker. It also
   checks the transient capacity patterns before auth, so a 429 that mentions
   "unauthorized" stays `unknown`; js-sdk's copy would call that `auth`. Same
   decisions (only a closed usage window or a rejected credential refuses), one
   vocabulary. wafflebase's AUTH list is wider than js-sdk's copy (`permission
   denied`, `not authenticated`, `/login`); those still read as `auth`.
5. **The picker's direct-run guard** moved to `path.resolve` + `fileURLToPath`
   (js-sdk had already fixed it); wafflebase's old `file://${argv[1]}` template
   did nothing from a path with a space or `%`.
6. **`test-removals.mjs` matches this repo's runners**: Vitest and `node --test`
   `*.test.*`, Jest `*.spec.ts` and `*.e2e-spec.ts` (`packages/backend`),
   `tsx --test` `*.integration.ts` (`packages/frontend`), plus Jest's `xit`,
   `xtest`, `xdescribe`, `.failing`, and `fit` only with a string title (a
   local `fit()` helper exists in `fit-to-content.test.ts`). Names are matched
   dot-separated only; js-sdk's `[._]` would make `hit-test.ts` a test here.
   node:test's `{ todo }`/`{ skip }` option is counted, wrapped or not. The D2
   prompt rule names `test.failing` for the backend's Jest.
7. **`test-removals.mjs` joined the panel identity** (`eval/panel-identity.mjs`).
   Its lines reach the adjudicator, so it can change which disputes are
   overturned; the import walk test failed until it was classified. The digest
   version moved to `@2`, as that module's own rule asks for a file-set change.
8. **The `agent-fix.yml` record** is posted from its own `fix-evidence` job.
   js-sdk posts it from its `report` job.
9. **The fixer's wall** in the probe comment is 90 minutes here (55 in js-sdk);
   nine dead slots cost at most 4.5 minutes of it.
10. Small: the "SPEND THE ROUND HERE" comment block moved back next to the step
    it describes (it had drifted above the credential picker); the loop-status
    note names the infra page as a possible pager.

### Independent review

One reviewer agent over the whole branch diff: no blocking findings; it
re-ran the suite and the bogus-token probe and confirmed the byte-identity
claim. Fixed from its findings:

- major: the first `fit` alternative matched the local `fit();` helper calls,
  which could report phantom removals or mask a real one. Now requires a title.
- `isRunnableTest` was wider than the runners (`hit-test.ts`). Narrowed.
- `classifyRefusal` let auth words win over a transient 429. Reordered.
- Comments: the infra-page step's reason for `stalled` paging, the
  `fix-outcome.mjs` header, and the merge skill's "`agent:ready` stays" (the
  label reads `agent:reviewing` until promote re-runs on green CI).

Left as is, shared with js-sdk: the infra page promises a rerun reuses
verdicts, which holds only when every applicable lens stamped state; the issue
fetch calls a 404 `unreadable` (design-fit then gets no note rather than the
no-spec note).

### Second review (coordinator)

Nothing blocking. Fixed, each with a test that was Red first:

1. **Focus is a disablement.** Jest in `packages/backend` has no CI guard
   (`CI=true jest --ci` reports "1 skipped, 1 passed", exit 0) and there is no
   `no-focused-tests` rule, so `it(`→`it.only(`/`fit(` or `describe(`→
   `describe.only(`/`fdescribe(` silently stops the siblings. An added focus is
   now counted as `focused`, apart from cases and netted only against removed
   focus lines. Counted for every runner, Vitest included (Vitest rejects
   `.only` under CI, but one rule is simpler and costs nothing). The local
   `fit();` helper stays excluded by the string-title rule.
2. **Switches are summed raw across a round, then clamped once.** A suite
   skipped in one commit and re-enabled in the next was `suitesOff: 1` (each
   commit clamped, then summed). Cases stay summed, so a test committed and
   deleted inside the round is still flagged.
3. **node:test has a keep-it-failing form.** `it.fails`/`test.failing` are
   undefined under node:test (106 `scripts/**/*.test.mjs`, the frontend's
   `*.integration.ts` under `tsx --test`) and crash the file. Both prompts now
   give `{ todo: 'still reproduces: <finding>' }`, and the detector counts a
   newly added `{ todo`/`{ skip` option on a case as `optionsOff`, so it reaches
   the adjudicator as evidence.
4. **Detector edges.** A rename with no `patch` but `changes > 0` is
   unreadable, not a pure move. More than 50 round commits marks the record
   `truncated` (and an empty truncated record is still posted and believed)
   instead of silently dropping commits. `agent-fix.yml`'s evidence step no
   longer says "did not advance" when `gh api` failed. The overlong `CASE`
   comment is rewrapped.

Known limits, not fixed:

- Commenting a case out by wrapping it in `/* … */` changes only the two
  comment lines, so nothing is counted. (`// it(` is seen: the `it(` line is
  removed.)
- Disable-one-add-one nets to zero: `it.skip` on one case plus a new `it` on
  another is not reported (switches are not netted, cases are).
- A deletion inside a merge commit the fixer made is not seen; merges are
  skipped as main's.
- A test excluded through runner config (`vitest.config` `exclude`, Jest
  `testPathIgnorePatterns`) is not seen; only test files are read.
- The PR commit list is capped at 250 by the API, so a longer PR attributes
  nothing past it.

- **The removal record races the next round.** The fixer's push starts CI,
  the panel workflow starts on CI's `requested` event, and that run supersedes
  this one. The next round reads fix reports after its gate, `deps`, checkout
  and the steps up to "Read fix-agent reports" — about 1–3 minutes after the
  push. `fix-evidence` has to post inside that window; a record that loses is
  never used, because the following round reads only the latest report.
- **Unverified: does a superseded `fix` job still publish its outputs?** When
  the push cancels the run, `fix-evidence` starts under `always()`, but whether
  `needs.fix.outputs.*` (`proceed`, `before`) are populated from a job that was
  cancelled mid-flight must be checked on the first real round. If they are
  empty, `fix-evidence` skips and no record is posted. js-sdk's `fix-report`
  has the same open question.

### js-sdk follow-ups

Shared bugs, to fix in yorkie-js-sdk's copies:

- The probe classifier there lets auth words win over a transient 429
  (`"429 … unauthorized"` → `auth`), which can latch a PR on a blip.
- Suite switches are clamped per commit and then summed, so skip-then-unskip
  inside one round reports a disabled suite (item 2 above).
- The detector edges in item 4: a content-changing rename without a patch, the
  silent 50-commit cap, and the "did not advance" log on a failed `gh api`.
- Focus (`.only`, `fit`, `fdescribe`) is counted as an active case there too;
  less urgent if its runners reject `.only` under CI.
- `fingerprint.test.mjs` builds its fixture repo with the inherited
  environment. Under any git hook that runs it, it writes to the real repo. Pin
  the fixture's `GIT_DIR`/`GIT_WORK_TREE` and strip the other `GIT_*` location
  variables there and in yorkie.

### Code review (/code-review high)

The wafflebase-specific findings, each checked against the code before
anything changed. The shared modules (`review-scope`, `review-state`,
`fix-report`, `carry-verdicts`) are left to the yorkie fix and are not touched
here.

1. **Confirmed: a `{ todo }` option Prettier wraps is not seen.** The prompt's
   form, `test("long title", { todo: '…' }, async () => {…})`, overflows 80
   columns. Prettier (this repo's `.prettierrc`) then puts the opener, title,
   options and callback on lines of their own, and breaks a long object one key
   per line. `OPTION_OFF` was tested only on a line that also matched `CASE`, so
   the record stayed empty. Red: the wrapped `git diff` shapes counted no
   option. Fix: `wrappedOptions` reads each side of the patch as its own file
   (context lines belong to both), finds the options slot of a wrapped case
   (a bare `it(`/`test(` opener, then a quoted title, then the object), and
   counts an option only where its key line changed on that side. Not counted:
   an option that was already there and is re-wrapped, re-indented or left as
   context next to an edited title (it is removed on one side and added on the
   other, or not changed at all), a `test.each` table, a look-alike call, an
   object in the body, a nested key.
2. **Confirmed: a dead pool still did the fixer's setup.** With
   `available=false` the panel's `fix` job still minted the App token, checked
   out the branch, ran `pnpm install` and set `agent:fixing`, a step before the
   page set `agent:blocked`. Those six steps now also need
   `steps.cred.outputs.available != 'false'`. The page needs only the staged
   scripts, the probe and the GITHUB_TOKEN; none of those is gated, and the
   post-agent steps that still run on this path need none of the skipped ones
   (`metrics.mjs record` bails without an execution log). Pinned in
   `infra-wiring.test.mjs`, Red on the old workflow. **Refuted for
   `agent-fix.yml`**: it has no probe (`pick-credential.mjs` picks a slot and
   never writes `available`), so there is no dead-pool path to gate.
3. **Confirmed: the removal record blamed later pushes on the fixer.** AFTER
   was the branch head read when `fix-evidence` ran, which comes after the fix
   job's reporting steps and a fresh runner's start. A commit a human pushed in
   that gap was in the compare and in the PR's commit list, so it counted.
   (update-branch only adds a merge, which was already skipped.)

   Design: the round's commits are the ones the **fixer's credential pushed**
   after the round started, read from the repository activity log
   (`GET /repos/{o}/{r}/activity?ref=refs/heads/<branch>`), which names the
   authenticated pusher. Measured on #1077: the pushes are `yorkie-agent[bot]`
   (the App) and the commits say `claude[bot]`. The actor (`app-slug` of the App
   token step) and the start time (`since`, stamped in `before-fix`) are step
   outputs written before the agent runs, so the agent cannot change them.
   Each fixer push's own compare is read, filtered as before (in the PR's
   commit list, not merges), and deduplicated; a human push in between, before
   or after is in no fixer push's range.

   Rejected:
   - *The SHA the fixer pushed*, from inside the fix job: every step after the
     agent runs on its terms (`$GITHUB_ENV`, `$GITHUB_PATH`, `.git/config`), and
     its own report is a claim that could stop short of the commit that deleted
     a test.
   - *Stop at the first commit not by the fixer's identity*: the author and
     committer are whatever the agent's git config says, so a fixer could sign
     one commit as a human and end the walk before its deletion. The identity is
     also shared by every agent workflow here.

   Red: `fixerPushes`/`pushedRoundCommits` did not exist, and the wiring test
   failed on the old workflows. Live check against the real API, with
   `gh pr comment` shimmed out: on #1077 it read the bot's one push and found
   nothing removed; with another actor it attributed nothing. That run also
   found a bug that predates this change: the PR commit list was read with
   `--jq .[].sha`, which prints bare shas, and parsing them as JSON threw, so
   `main()` always logged "could not read the round's commits" and never posted.
   Now `.[].sha | tojson`.

   Limits: the activity endpoint with the GITHUB_TOKEN (`contents: read`) is
   documented for installation tokens but has not run in Actions yet. If it
   fails, nothing is recorded, as with any unread round. A second fixer pushing
   with the same App inside the window (a `@claude fix` beside an autonomous
   round) is counted as this round's. A full page of 100 activities that does
   not reach `since` marks the record `truncated`.

Verification: `cd scripts/agent && npm test` 2741 pass, 0 fail (2733 before);
`pnpm lint:scripts` clean; `verify:doc-index`, `verify:doc-links` pass.

**Shared-module fixes, carried from the yorkie port (yorkie#2086).** The
yorkie diff for `review-scope.mjs`, `fix-report.mjs` and their tests applies
here unchanged. `review-scope.mjs` is byte-identical to yorkie's again.
- A failed permission lookup can force a review, but it can no longer cancel a
  trusted `@claude rerun review`. A 404 counts as no access. Reruns are
  filtered by time before any permission call, and trust is resolved newest
  first.
- Carry survives a clean rebase. The replaced head is found through GraphQL
  `HeadRefForcePushedEvent.beforeCommit`. It is used only when it holds the
  newest verdicts, and only to carry.
- Removal records for the same head are merged per file instead of the last
  one winning.
- `evidence-wiring.test.mjs` now requires every `--jq` that `ghLines` parses to
  print JSON. That is the class of the `.[].sha` bug above, which yorkie had
  as well.

After: `scripts/agent` 2749 pass, 0 fail.

### Verification

- `cd scripts/agent && npm test`: 2749 tests, 2749 pass, 0 fail after the
  /code-review fixes and the shared ones from yorkie (2741 before those); 2733 after the second review (2728 before it;
  baseline 2659: 2654 pass, 5 skipped before
  `pnpm install`).
- `pnpm lint:scripts`: clean. `verify:doc-index` and `verify:doc-links`: pass.
  `verify:entropy`: knip 0 dead code (after building `design-editor`, whose
  `dist/` knip loads), doc staleness 0 blocking, and one failure that is not
  this change's: `pnpm audit` reports a critical advisory in the untouched
  lockfile. The one advisory naming `harness-engineering.md` predates it.
- The probe against the real Agent SDK from a staged copy: with no SDK it logs
  and falls back to the pool state; with a bogus token it classifies `auth` and
  returns `available=false` (`probe-all-refused`). Not run with a valid token.
- Commit messages checked with `.githooks/commit-msg`. The first seven commits
  used `--no-verify` and ran the gates above by hand; the second-review commits
  went through the hooks, including the full `pnpm verify:fast`.
- Not verified until it runs on GitHub: the workflow wiring end to end. The
  structural tests pin step order and conditions, but no wafflebase PR has gone
  through a carry, a reuse, a live probe, an infra page or a removal record.
