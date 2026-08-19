# Agent pipeline: never publish raw upstream error text — Task Tracking

Reference: [wafflebase/agent-pipeline#2](https://github.com/wafflebase/agent-pipeline/pull/2)
(open, unmerged — the origin of the approach, **not** a mergeable fix, and
deliberately generalised beyond it here).

Code under change: `scripts/agent/` (line numbers as of `ffbee7272`).
Branch: `fix/agent-credential-redaction`.

## Incident

A `CLAUDE_CODE_OAUTH_TOKEN` was rotated with a stray space. A space makes an
`Authorization` header value structurally invalid, so the HTTP client rejects it
**before sending** — and that error class quotes the offending value back:
`Header 'Authorization' has invalid value: <token>`. The SDK surfaces that as its
`result` text, `classifyResult` carries it as `detail`, and the panel interpolates
`detail` verbatim into a lens summary that fans out to a check-run body, a PR
comment and the job summary. The credential was published to a public PR.

Two things did not save us, and both are routinely assumed to:

- **GitHub Secrets.** "In secrets" means not committed and scrubbed from logs. It
  never meant the process cannot read the value — the panel *must* put the token
  in an `Authorization` header, so it necessarily holds it in memory.
- **Log masking.** Masking rewrites console output. A PR comment is a request body
  we ask GitHub to publish; there is no log for a scrubber to sit in front of.
  Masking is also exact-substring, and GitHub splits registered secrets on
  whitespace — so a token stored *with a space* registers as fragments.

Note the shape: a merely **wrong** token gives a clean 401 with no echo. The typo
is what converted an auth failure into a disclosure.

## Why PR #2 cannot simply be merged

It targets `wafflebase/agent-pipeline`, opened 2026-08-14 05:59 UTC. Two hours
later `abf4c6451` (#850) reversed the eight-PR extraction and brought the pipeline
back here as `scripts/agent/`. #850 restored files *from history*, i.e. the
unfixed versions, and deleted the vendoring machinery — no
`scripts/vendor-pipeline.mjs`, no `VENDOR.json`, no pinned `agent-pipeline` ref in
`.github/workflows/`. PR #2's own "Follow-up required in wafflebase" section
describes a mechanism that no longer exists.

## Why a verbatim port is also not enough

PR #2 builds its exact-match and whitespace-fragment layers from a **frozen
five-name allowlist** headed by `CLAUDE_CODE_OAUTH_TOKEN`. That predates
`21424035c` (#854), which spread the pipeline across a **pool of nine**
credentials (`token-pool.mjs`, `MAX_SLOTS = 8`). Ported verbatim it would leave 8
of 9 live credentials outside the layer its own docblock calls "THE POINT".

But raising the allowlist to nine only moves the same fragility forward one step.
**Any design whose safety depends on enumerating credentials will rot** — at
`MAX_SLOTS = 16`, at the next provider, at the first error shape nobody predicted.

So this task inverts the model rather than extending the list.

## Design: two independent guarantees

Neither layer may depend on knowing how many credentials exist or where an error
came from. They are ordered so that a failure of one is covered by the other.

### Guarantee 1 — no raw upstream text is ever published

Upstream prose does not reach a published surface at all. `classifyInfraError()`
maps a failure onto a **closed vocabulary** of standardized codes, and every
published string is *constructed* from that vocabulary plus typed primitives —
never quoted from the SDK.

| Code | Meaning | Operator action |
| --- | --- | --- |
| `AUTH_MALFORMED_CREDENTIAL` | Header rejected before send — the incident's own shape | Fix the whitespace in the secret |
| `AUTH_REJECTED` | 401/403 | Rotate the credential |
| `USAGE_LIMIT` | Session/usage window closed | Wait for reset |
| `RATE_LIMITED` | 429 without limit prose | Retry later |
| `UPSTREAM_ERROR` | 5xx or unrecognised status | Upstream problem |
| `NO_RESPONSE` | No status — transport/DNS/refused header | Check connectivity |
| `RUN_LIMIT` | Our own turn/budget ceiling | Raise the ceiling |
| `NO_OUTPUT` | Ran, produced no verdict | Investigate the lens |

`AUTH_MALFORMED_CREDENTIAL` is called out separately on purpose: it is the only
code whose remedy is "fix the secret's formatting" rather than "rotate" or "wait",
and it is precisely the case that leaked.

**Context is constructed, never quoted.** The only fields that may accompany a
code are typed primitives from known-safe sources — `status` (number),
`turns` (number), `retryable` (boolean). No free text, so there is no channel for
an unreviewed string to ride out on.

### Guarantee 2 — unconditional pattern-based masking

A defence-in-depth filter applied at the publication boundary that masks anything
*resembling* a credential, with no knowledge of the pool. Layers, in order, each
guarded by `(?!<REDACTED)` so a later rule cannot degrade an earlier label:

1. **Echo frames** — `Authorization … value: <rest-of-line>` and relatives.
   Matches by *frame*, not by secret shape, so it catches a credential of any
   format including one no pattern below recognises. This is the rule that would
   have stopped the incident on its own.
2. **Known credential shapes, whitespace-tolerant** — `sk-ant-`, `sk-`, `gh[pousr]_`,
   `github_pat_`, `wfb_`, JWT. Each consumes trailing whitespace-separated runs
   that still look like secret material, so a **malformed** token is masked whole
   rather than leaving its tail exposed.
3. **Generic high-entropy runs** — any ≥ 24-char run mixing upper, lower and digit.
   This is the "anything resembling a token" catch-all and needs no prefix at all.
   Deliberately excludes lowercase-hex (git SHAs) and UUIDs, which this pipeline
   prints constantly and which are not secrets.
4. **Generic key/value** — `token=…`, `secret: …`, `x-api-key …`.
5. **Live env values + their whitespace fragments** — supplementary only, now
   *derived* from `poolEnvNames()` so it cannot drift from `MAX_SLOTS`. Demoted
   from PR #2's primary defence to a bonus layer, because Guarantees 1 and 3 no
   longer depend on it.

### Consolidation

`scripts/agent/hunt-probe.mjs` already exports a weaker `redactSecrets` (no
fragments, no `sk-ant-`/GitHub/frame rules, no `(?!<REDACTED)` guards) used by the
hunters. PR #2 justified duplicating it with "the two repos cannot import from each
other" — a premise #850 dissolved. `hunt-probe.mjs` re-exports the strong
implementation, so the hunters inherit it and no caller changes.

## Plan

### Step 1: `scripts/agent/redact.mjs` (new)

- [x] `redactSecrets(text, { extra })` — the five layers above, ordering documented.
- [x] `credentialEnvNames()` — derived from `poolEnvNames()` plus non-pool names
      (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`).
- [x] `secretsFromEnv()` — values + whitespace fragments, longest-first, `MIN_SECRET_LEN = 8`.
- [x] `INFRA_CODES` + `classifyInfraError({ kind, status, detail })` → `{ code, reason, context }`.
- [x] `renderInfraError()` → `[CODE] reason (HTTP nnn)`, built only from the vocabulary.
- [x] Keep both bugs PR #2 found fixed: `(?!<REDACTED)` lookaheads, and
      nullish-status checked **before** `Number.isFinite` (`Number(null) === 0`
      renders "HTTP 0").

### Step 2: Consolidate the hunter redactor

- [x] `hunt-probe.mjs` re-exports `redactSecrets` from `redact.mjs`.
- [x] Confirm the `{ extra }` signature stays compatible (hunters pass
      `{ extra: secrets }`); note the default changes `[]` → `secretsFromEnv()`.
- [x] `hunt-probe.test.mjs` stays green as the compatibility pin.

### Step 3: Classify at the source (`ask.mjs`)

- [x] `classifyResult` gains `code` / `reason` / `publicDetail`, computed from the
      **raw** text, and returns `detail` already redacted.
- [x] **Retryability decided from raw text before scrubbing**, so redaction can
      never change a classification.
- [x] `isAccountLimit` prefers `err.code === USAGE_LIMIT`, falling back to the
      existing regex so callers constructing bare `{ kind, detail }` still work.
- [x] Verified safe: `pool.advance(reason, deadToken)` never reads `reason`, so
      failover is unaffected by scrubbing.

### Step 4: Publish only the vocabulary

- [x] `review-panel.mjs` (~L2611-2613) — build the lens summary from the code, not
      from `detail`.
- [x] Named `infraSummary()` so the wire format has one owner.
- [x] Defensive `redactSecrets` on every remaining renderer that touches `detail`:
      `guard-verdict.mjs` (L91-92), `metrics.mjs` (L864, L881),
      `session-job-summary.mjs` (L50-52), `review-round-guard.mjs`.
- [x] Full (redacted) detail still goes to the run log.

### Step 5: Pin the wire format

`Review could not run — Claude API/quota error` is parsed by two consumers:

- `prior-findings.mjs:33` — `INFRA_SENTINEL` (`startsWith`)
- `rounds.mjs:565` — `INFRA_SUMMARY` (anchored regex)

Breaking it carries a stale infra record forward **as a code finding** and sticks
the loop a round later, on whatever PR next hits a quota error. The new summary
therefore keeps that exact prefix and appends the code:
`Review could not run — Claude API/quota error [AUTH_REJECTED]: credentials rejected (HTTP 401)`.

- [x] `infra-summary.test.mjs` — pin `infraSummary()` against **both** consumers.

### Step 6: Tests

- [x] `redact.test.mjs` — the incident reconstructed; each layer proven **in
      isolation** (disable the others) so no rule's coverage is silently carried by
      another.
- [x] **Pool-independence test** — a malformed token in `CLAUDE_CODE_OAUTH_TOKEN_5`
      *and* one in a slot beyond `MAX_SLOTS`, masked with the env layer switched
      off. This is the test that fails against a verbatim PR #2 port.
- [x] **Unknown-shape test** — a credential in no recognised format, masked by the
      frame and entropy rules alone.
- [x] **Counterweight test** — git SHAs, UUIDs, file paths, ordinary prose and stack
      traces left intact. Over-redaction destroys the diagnostics this pipeline exists
      to produce.
- [x] `ask.test.mjs` — classification unchanged by scrubbing; a session limit stays
      non-retryable; `code` correct for each branch.
- [x] **Leak check across all surfaces** — drive the incident's SDK message through
      every renderer that publishes `detail` and assert zero leaks.

## Verification

- [x] `cd scripts/agent && node --test-timeout=60000 --test '**/*.test.mjs'`
- [x] `pnpm verify:self`
- [x] `pnpm lint:scripts`, `pnpm verify:entropy`, `pnpm verify:doc-index`

## Deviations from the plan, and why

- **`lensFailureSummary()` extracted from `runLens`'s catch block** (not planned).
  The panel's failure summary is the highest-risk string in the pipeline, and while
  it lived inline the only way to exercise it was a live API run against a whole
  lens. It was therefore the one string with *no test* — which is how it came to
  publish a credential. Extracting it made the leak check able to drive the real
  code path rather than a reconstruction, and a mutation reintroducing the original
  bug now fails the suite.
- **`RUN_LIMIT` split into `RUN_LIMIT_TURNS` / `_BUDGET` / `_OUTPUT_RETRIES`.** The
  old message named the ceiling by interpolating the SDK's subtype string. Keeping
  that would have left a free-text channel; adding codes keeps the vocabulary closed
  *and* keeps the operator's "raise turns vs raise budget" distinction. An
  unrecognised subtype degrades to the generic `RUN_LIMIT`.
- **`hunt-probe.test.mjs` label expectation updated.** `Authorization: Bearer
  sk-secret-…` is now labelled `<REDACTED_API_KEY>` rather than the generic
  `<REDACTED>`, because the `sk-` shape rule recognises it before the Bearer rule
  sees it. The safety assertion in that test (`doesNotMatch` on the raw value) is
  unchanged and still passes; only the label is more specific.
- **`guard-verdict.mjs` had a second `v.infra` site** on the PROCEED path, not just
  the page path. Found by sweeping rather than by the plan.

### Two further leak sites, found after the first sweep

Both are the same defect class and neither was in the original plan. The first
sweep grepped `\.detail\b` — property *access* — which is why it missed them.

- **`auth-smoke.mjs` echoed the credential to a public Actions log.**
  `describeFailure` interpolated the raw SDK message into text printed by
  `console.error`, and this repo is public, so its Actions logs are. Worse, this is
  the tool you run *when a credential is broken*, so a malformed secret reaches it
  by design rather than by accident. GitHub's masker is no defence here — it is the
  exact-substring matcher that whitespace defeats. `classifyFailure` runs on the raw
  text upstream, so scrubbing cannot change the diagnosis, and what survives
  (`invalid value: <REDACTED>`) still names the fault exactly.

- **`review-execution.json` shipped raw SDK messages as a workflow artifact.**
  `sessionLog` is written verbatim by the panel and both hunters and uploaded with
  `retention-days: 1` — downloadable by anyone with repo read access, i.e. everyone.
  `message.result` is raw upstream text. Fixed at the single shared producer in
  `runSession`, which covers all three logs. Verified nothing reads it back:
  `parseExecution`/`sumExecutions` consume `usage`, `num_turns`, `duration_ms`,
  `total_cost_usd` and `session_id` only.

### Request ids: extracted, not exempted

`req_…` identifiers are what support asks for first, and the entropy rule masks
them (mixed case, over 24 characters). Exempting them would punch a hole in a
filter meant to be unconditional — and the hole stays open to whatever else
matches. Instead `classifyInfraError` lifts the id out as structured context and
re-emits it **from the literal match** of an anchored, length-bounded pattern, so
the only thing that can leave is `req_` plus bounded alphanumerics. It refuses to
emit anything overlapping a live credential, which cannot fire in practice (no
provider here issues a `req_` secret) but makes the channel provably disjoint from
the credential set rather than disjoint by assumption.

This also fixed a latent fragility: `lensFailureSummary` was re-deriving the
classification from the **already-redacted** `detail`. That happens to work, since
no limit or malformed-header phrase is credential-shaped, but it depended on that
staying true — and it could not recover a request id the entropy rule had already
masked. `reason` is now carried through from `classifyResult`, which built it from
the raw text.

The stated invariant weakens honestly: `context` is numbers **plus one
pattern-validated string**, not numbers only.

## Verification performed

- `scripts/agent`: **2178 tests, 0 fail** (2151 before; +27).
- `pnpm lint:scripts`, `pnpm verify:entropy`, `pnpm verify:doc-index` — all clean.
- `pnpm verify:fast` — green except two **pre-existing frontend flakes**
  (`text-edit-section.test.ts`, `csv-doc-size.test.ts`), both 5000 ms timeouts under
  full-suite parallel load. Both pass in isolation, and this branch touches zero
  files under `packages/frontend/`.
- **Mutation-tested, because a green test proves nothing until it has failed.**
  Each of the five layers was individually disabled and the corresponding test
  confirmed to fail; reverting `review-panel.mjs` to publish `err.detail` — the
  original bug — fails the end-to-end leak check; reverting `metrics.mjs` to raw
  detail fails the legacy-record test.

## Risks

- **Over-redaction.** The entropy rule is the aggressive one. Mixed-class + ≥24
  chars excludes git SHAs (lowercase hex) and UUIDs by construction, and the
  counterweight test is not optional.
- **Wire format.** Two parsers key on the sentinel; Step 5 is what makes the
  refactor safe.
- **Diagnostic loss.** Operators lose upstream prose from PR comments by design.
  The code vocabulary carries the actionable distinction, and the redacted full
  text remains in the run log, whose audience can already read the workflow.
- **Not closed until merged.** There is no vendor pin — the workflows read
  `scripts/agent/` from the default branch, so merging to `main` *is* the deploy.

## Out of scope

- **Rotating the exposed credential** — operational, and more urgent than this code.
- **Sweeping past PR comments / check-run bodies** for other published tokens.
- **Slot-name attribution** (`slot CLAUDE_CODE_OAUTH_TOKEN_5 is the bad one`).
  Genuinely useful, but it needs `authToken` threaded into `classifyResult`, which
  changes a signature used across the panel and hunters. Deferred rather than
  half-wired.
