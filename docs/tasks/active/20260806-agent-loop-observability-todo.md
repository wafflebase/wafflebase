# Make the review→fix loop legible from the PR page (observability, phases 1–3)

## The problem

The pipeline computes everything a maintainer would ask — which round the loop
is on, why it continued or stopped, what a round cost — and then discards it:
the round guard's PROCEED decision writes only `$GITHUB_OUTPUT`, per-session
cost lives in hidden `<!-- agent-metric -->` comments, and the whole pipeline
wrote exactly one `$GITHUB_STEP_SUMMARY` line (the review-scope note). From the
PR page a continuing loop and a dead loop looked identical; only pages spoke.

## The change

- [x] **Sticky loop-status comment** (`scripts/agent/loop-status.mjs`, marker
      `<!-- agent-loop-status -->`): round table + fix-round budget + latest
      decision + effort totals. A projection, never a gate — re-derived in full
      from commits/check runs/paged latches on every update; author-checked
      upsert; ledger parsed from trusted-author comments only, numbers-only
      rendering (a fake metric record must not be able to launder a trusted
      marker into a bot-authored body). Update hooks in the panel workflow
      (panel / promote / guard decision / fix outcome / stalled), the CI arm,
      `@claude fix` and `@claude rerun`.
- [x] **Round-guard verdict surfacing** (`guard-verdict.mjs`, pure rendering):
      every guard path — including the previously silent PROCEED — emits a
      one-line `verdict` output and a job-summary block. Page detail is fenced
      inert (it embeds finding summaries derived from the untrusted diff).
- [x] **Job summaries**: `panel-job-summary.mjs` (per-lens verdict/verifier/
      cost table, fail-closed message when `panel.json` is missing),
      `session-job-summary.mjs` (turns/tokens/cost/outcome per Claude session),
      the CI-fix diagnosis teed into the run page, and SKIPPED/PAGED/PROCEED
      blocks from the CI arm's attempts guard.
- [x] **Round 2 (review-panel findings)**: `checks: read` for the CI arm and
      rerun; author-checked CI paged latch (was body-only — any account could
      stop the loop); both latches feed the paged projection; `Number(null)`
      budget-line bug fixed ("N of 0"); `ready` derived from agent/-branch
      promotion, not bare non-draft-ness; `--required-checks` so the displayed
      budget counts what the guard counts; upsert self-heals duplicate
      comments; check-run fetches capped at 40 commits; CI-arm scripts run from
      a pre-fixer snapshot; summary writes fail-safe and ordered after outputs.

## The change, phase 2 — findings and money become precise

- [x] **Enriched lens check-run bodies** (`scripts/agent/severity.mjs`):
      `file:line` locators on every row (`novelty.mjs::findingLocation` — the
      finding's own line, else the first same-file evidence citation);
      per-finding verifier outcome (confirmed high/low, the existing unsettled
      wording, UNVERIFIED-errored) stamped as a reporting-only `verification`
      field by `annotateFindings` from the same null-verdict signal
      `verifierTally` counts; the adjudicator's decision AND prose reason as a
      sub-bullet on disputed findings (previously computed then discarded from
      every human surface); an Author-reported skips section with the author's
      note. The adjudication reason and skip note — the two author-adjacent
      strings — are `<!--`-neutralized because lens bodies are copied into a
      bot-authored comment; new sections use the `\n###` marker (plus the
      trailing space) the fixer cut relies on, and the corpus reader's
      round-trip is pinned by a cross-module test against the real renderer.
- [x] **Per-session ledger** (`scripts/agent/metrics.mjs::renderLedger`): a
      chronological kind/turns/tokens/cost/duration table in a `<details>`
      fold of the effort summary, with round ordinals on `review`/`review-fix`
      rows. Rendered before any sweep, so `--final` keeps it. Missing values
      render `—`, never `0`; `kind` is allow-listed (records are parsed from
      ANY comment — free text must not reach a bot-authored body).
- [x] **"Where to look" on every 🛑 page**: run link + job/step + transcript
      artifact appended to the round guard's pages
      (`guard-verdict.mjs::whereToLookLine`/`runUrlFromEnv`, null-safe — no
      partial URLs), the CI arm's attempts-cap and no-advance pages, the panel
      fix job's no-advance page and the `stalled` safety net.

## The change, phase 3 — the dispute channel and the leftovers

- [x] **Visible rebuttal bodies** (`renderRebuttalComment` in
      `scripts/agent/rebuttal.mjs`): the disputed finding, claim, citations
      and the "claim awaiting adjudication, upholds by default" framing above
      the unchanged hidden record. Read side untouched (marker matched
      anywhere, author-gated). Two serialization hardenings shipped with it:
      author fields `<!--`-neutralized (both paged-latch predicates are
      containment tests gated on the App-token identity rebuttals post under),
      and the `-->` terminator transport-escaped as in
      `scripts/agent/fix-report.mjs` — fixing a pre-existing silent failure
      where a dispute quoting any repo marker truncated its JSON and was
      never posted.
- [x] **Best-effort failure breadcrumbs** (`emitBestEffortWarning` in
      `scripts/agent/guard-verdict.mjs`): the fail-safe scripts (set-state,
      loop-status, metrics) exit 0 on operational failure BY DESIGN, so
      `continue-on-error:` never observes them — their bail paths now emit a
      `::warning::` annotation + job-summary line naming the consequence.
      Opt-in per call site in `scripts/agent/metrics.mjs` (bail also serves
      normal no-ops; warning on those teaches readers to ignore it). The
      implement ack gained the `core.warning` catch the other inline
      github-script steps already had.
- [x] **Kickoff dead-run visibility** (`.github/workflows/agent-implement.yml`):
      an always-step that comments on the issue when the run ends with no open
      `agent/<issue>-*` PR — run link, artifact name, retry command — with
      three-state honesty (PR found → silent; none → dead-run comment; PR list
      unreadable → says so, never asserts a failure it did not verify).

## Deliberately not done
- Counting on-demand `@claude fix` rounds against `MAX_REVIEW_ROUNDS` (a loop
  behavior change, tracked separately in harness-engineering.md's "not yet
  built" list).
- Persisting the incremented `adjudication.upheld` into `verdict.json` /
  `output.text`: today the adjudicated copies live only in the gating array,
  so the count can never reach the standstill bound — a real pre-existing
  behavior bug, deliberately NOT folded into this rendering-only change and
  tracked as its own fix.
