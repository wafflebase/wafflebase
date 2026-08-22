# Autonomous Issue Hunting (Phase 26) — Task Tracking

Design doc: [harness-engineering.md](../../design/harness-engineering.md) → Phase 26

## Principles

- **Fail QUIET, not closed.** Inverted from the review panel: uncertainty drops the
  candidate. A false positive costs maintainer attention; a false negative costs
  nothing, because the next run looks again.
- **The model never holds a shell.** It proposes `argv`; trusted code executes.
- **Every charter carries its own oracle.** "Look for bugs" produces slop.
- **The trusted script decides, the model only classifies.** Same architecture as
  the review panel, opposite polarity.

## Step 0: Shared SDK wrapper (#578, merged)

- [x] `scripts/agent/ask.mjs` — `askStructured` extracted; `allowedTools` a required,
      validated parameter with an allow-list (`PERMITTED_TOOLS`), not a deny-list
- [x] `review-panel.mjs` grants `REVIEW_TOOLS` explicitly at both call sites
- [x] `classifyResult` decides retryability from `api_error_status`, not prose
      (`resets?\b` matched `ECONNRESET`; `rate limit` contradicted its own docblock)
- [x] `ask.test.mjs` — deny-list, scoped-rule and MCP bypasses, malformed input

## Step 1: Tier-1 hunter

- [x] `hunt-gate.mjs` — `isFilingVerdict` (4-stage), `codeLocations`, `sameDefect`,
      `intersectSamples`, `coerceCandidates`, `huntSeverity`, both JSON schemas
- [x] `hunt-probe.mjs` — replaced-env clean room, argv execution via `spawnSync`,
      3× replay, `assertSafeArgv`, `renderReproSh`, `redactSecrets`
- [x] `hunt-fingerprint.mjs` — `defectKey`, `observedKey`, ledger + `LEDGER_KEY_VERSION`
- [x] `hunt.mjs` — orchestrator; `preflight` / `run` / `report`
- [x] `charters/` — `charters.json` + `contract.md` + `crash.md`
- [x] 5 test files, auto-globbed by the `agent:tests` lane in `verify-self.mjs`
- [x] Live-run gate met: 2 human-confirmed defects, 0 false reports

## Step 2: Duplicate-suppression corpora

- [x] `hunt-corpus.mjs` — `extractNonGoals` (depth-agnostic), `extractDeferralLines`,
      `renderDeferrals`, `loadScopedDocs`, `renderIssues`, `fetchIssues`
- [x] Wired into `hunt.mjs` — corpora build automatically; `--issues`/`--deferrals`
      are overrides for reproducing a past run
- [x] `repoSlug()` resolves via `gh repo view`, not by assuming `origin`
- [x] Integration test reads the SHIPPED `cli.md` and asserts the four non-goals
      that previously became false positives are in the digest

## Step 3: Local front door + docs

- [x] `.claude/commands/hunt.md` — preflight → human gate (cost stated) → run →
      read the funnel → hand-verify → report
- [x] `harness-engineering.md` Phase 26
- [x] Paired task + lessons files

## Step 4: Backend tier (not started)

- [x] `round-trip` charter — import→export identity, `--pages` partition,
      `cells batch` ≡ N× `cells set`, `--dry-run` mutates nothing
- [x] `state` charter — create→delete→list, rename twice, revoke twice
- [x] `checkStack()` — charter SKIPPED (never failed) when the stack is down
- [x] **`WAFFLEBASE_HUNT_WORKSPACE` safety rail** — refuse to run if it equals the
      developer's resolved workspace; seed `hunt-<runId>-<n>`; `cleanup --run <id>`
- [x] Do NOT reimplement docker lifecycle — `verify-integration-docker.mjs` owns it

## Step 5: Promote to filing (not started)

- [ ] Rolling GitHub issue via the `metrics.mjs` hidden-comment pattern
- [ ] `--file` behind `HUNT_FILING_ENABLED`; labels `agent:hunted` + `needs-triage`
- [ ] **Never `agent:candidate`** — with a non-Bot author that is what lets the fix
      pipeline ingest a spec; a bot-filed one would close the loop on itself
- [ ] Mechanical kill switch: accept rate below a floor over a trailing window
      disables the workflow and pages (the curl lesson as a gate, not an intention)
- [ ] Gate: 20 consecutive reports at ≥90% maintainer-judged-real

## Step 6: Formula oracle (not started)

- [ ] Metamorphic self-differential in `packages/sheets/test/formula/` — no
      third-party dependency. `evaluate()` at `formula.ts:577` is sync and
      node-native; `FunctionCatalog` (462 entries) + `getArity` enumerate the surface
- [ ] Seam is a JSON artifact, not an import: `scripts/agent/` is a standalone npm
      package outside the workspace, and widening `packages/sheets`' public API for a
      test harness is the wrong trade
- [ ] Exclude by CATEGORY, not per-case: dates-as-strings, the scalar-returning array
      family (the real root cause of #274, larger than the issue states), and float
      `toString()`. Each is one architectural divergence producing hundreds of diffs
- [ ] Suppression list must self-invalidate — a stale entry fails the test, or the
      list silently becomes the spec

## Deferred / Non-Goals

- **UI hunting — no longer deferred; moved to Phase 28.** It was out of scope
  for this phase, and is now in progress: see
  `docs/design/harness-engineering.md` (Phase 28). PR 1 (#642) landed the
  browser executor, the `/harness/hunt` route and the free oracles; PR 2 (#665)
  adds the prediction protocol. Left listed here so the boundary between the two
  phases stays readable rather than silently rewritten.
- **HyperFormula as a formula reference.** GPLv3, incompatible with Apache-2.0.
  `@formulajs/formulajs` (MIT) is the candidate if Step 6 needs one.
- **Semantic/LLM dedup of candidates.** Deterministic overlap matching only; a model
  in the dedup path is a hallucination entering the input that prevents hallucinations.

## Findings filed from this work

- #585 — `--format yaml` documented but unimplemented; prints `undefined`, exits 0
- #586 — documented exit code 2 for system errors is never produced
