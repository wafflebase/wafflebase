// Incremental-review state: what each lens last reviewed, and whether this round
// may review only the delta.
//
// WHY THIS EXISTS. The panel re-reviews the FULL cumulative diff every round
// (`git diff origin/main...HEAD`), so an 8-round PR reads round-1 code eight
// times. Worse, both endpoints of `...` move: a human `git merge main` changed
// the reviewed artifact with no semantic change to the branch and flipped a lens
// verdict.
//
// WHERE THE STATE LIVES: `external_id` on each `agent-review-<lens>` check run.
// Every candidate sits behind the same `checks:write` trust boundary (the author
// agent cannot forge any of them), so the choice is about FAILURE MODES.
// `output.text` is disqualified: the panel workflow trims it to fit a 60k limit
// by dropping findings, i.e. it is DESIGNED to lose data. A control field that
// decides whether code gets reviewed must not live in a lossy channel.
//
// THE ONE RULE: every decision here fails to `full`. Reviewing code twice costs
// tokens; reviewing it zero times ships a bug. There is no symmetry between the
// two, so there is no case where "probably fine" resolves to `incremental`.

/** Bumped only if the shape changes; an unknown version parses as "no state". */
export const REVIEW_STATE_VERSION = 1;

const SHA = /^[0-9a-fA-F]{40}$/;
const MODES = new Set(["full", "incremental"]);

/** A 40-hex SHA, lowercased. Anything else → null (never throws). */
function sha(v) {
  return typeof v === "string" && SHA.test(v) ? v.toLowerCase() : null;
}

/**
 * Serialize state for a check run's `external_id`.
 *
 * Throws on malformed input rather than emitting junk. This is called only from
 * the trusted orchestrator with values it just computed, so bad input is a
 * programmer error — and the alternative (writing an unparseable `external_id`)
 * would silently degrade every later round to `full` with no signal. A throw
 * fails the panel step loudly, which is the correct direction.
 *
 * Key order is fixed so the value is stable across rounds and diffable by eye.
 * GitHub caps `external_id` at 255 characters; the widest shape here is ~170.
 */
export function serializeReviewState({ reviewed, base, since, mode }) {
  const r = sha(reviewed);
  if (!r) throw new Error(`review state: 'reviewed' must be a 40-hex sha (got ${JSON.stringify(reviewed)})`);
  if (!MODES.has(mode)) throw new Error(`review state: 'mode' must be full|incremental (got ${JSON.stringify(mode)})`);
  // base/since are optional — round 1 has no `since`, and `base` is diagnostic.
  const b = base === "" || base == null ? "" : sha(base);
  if (b === null) throw new Error(`review state: 'base' must be a 40-hex sha or empty (got ${JSON.stringify(base)})`);
  const s = since === "" || since == null ? "" : sha(since);
  if (s === null) throw new Error(`review state: 'since' must be a 40-hex sha or empty (got ${JSON.stringify(since)})`);
  const out = JSON.stringify({ v: REVIEW_STATE_VERSION, reviewed: r, base: b, since: s, mode });
  if (out.length > 255) throw new Error(`review state: ${out.length} chars exceeds the external_id limit of 255`);
  return out;
}

/**
 * Parse a check run's `external_id` back into state.
 *
 * Returns `null` for ANY doubt — absent, non-JSON, wrong version, missing or
 * malformed `reviewed`, unknown `mode`. Callers treat `null` as "this lens has no
 * usable state", which forces `full`. Deliberately strict: a half-understood
 * state is more dangerous than no state, because it would be acted upon.
 */
export function parseReviewState(raw) {
  if (typeof raw !== "string" || raw === "") return null;
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  if (d.v !== REVIEW_STATE_VERSION) return null;
  const reviewed = sha(d.reviewed);
  if (!reviewed) return null;
  if (!MODES.has(d.mode)) return null;
  const base = d.base === "" || d.base == null ? "" : sha(d.base);
  const since = d.since === "" || d.since == null ? "" : sha(d.since);
  // A present-but-malformed base/since means the writer disagrees with us about
  // the shape. Refuse the whole record rather than half-trust it.
  if (base === null || since === null) return null;
  return { v: d.v, reviewed, base, since, mode: d.mode };
}

/**
 * Latest COMPLETED run per lens check name, from a flat list of check runs.
 *
 * Shared by `prior-findings.mjs`, which needs the same "which run speaks for this
 * lens" answer — one implementation rather than two that drift.
 *
 * Two filters carry weight:
 *   - `app.slug === "github-actions"` — only the panel workflow may speak for a
 *     lens. Without it any App able to post a check could inject state.
 *   - `status === "completed"` — a queued/in-progress run has a newer timestamp
 *     but no verdict yet, and would otherwise shadow the last real one.
 */
export function latestLensRuns(runs, lensCheckNames) {
  const want = new Set(Array.isArray(lensCheckNames) ? lensCheckNames : []);
  const out = new Map();
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || typeof r !== "object") continue;
    if (!want.has(r.name)) continue;
    if (r.app?.slug !== "github-actions") continue;
    if (r.status !== "completed") continue;
    const t = new Date(r.completed_at || r.started_at || 0).getTime();
    const at = Number.isFinite(t) ? t : 0;
    const cur = out.get(r.name);
    if (!cur || at >= cur.at) out.set(r.name, { run: r, at });
  }
  return new Map([...out].map(([name, { run }]) => [name, run]));
}

/**
 * Decide this round's review scope. FULLY PURE — every git and API fact is
 * injected, so the whole decision table is unit-testable without a repository.
 *
 * Returns `{ mode, sinceSha, reason }`. `mode` is `full` unless every condition
 * for a safe narrowing holds; `sinceSha` is non-empty only when `incremental`.
 *
 * `reason` is a superset of the values the plan sketched, because a fused reason
 * is a worse diagnostic: `lens-state-divergence`, `no-new-commits`, and
 * `invalid-input` are split out rather than folded into `lens-state-gap`. Every
 * one of them still resolves to `full`.
 *
 * Checks run correctness-first, then policy, so the reported reason names a real
 * hazard when one exists rather than an arbitrary cap that happened to also fire.
 */
export function resolveReviewMode(opts) {
  // Destructure from a coerced object, NOT via a `= {}` parameter default: that
  // default only fires for `undefined`, so `resolveReviewMode(null)` threw — which
  // contradicted this function's whole contract of never throwing. Caught by its
  // own test.
  const {
    lensIds,
    states,
    headSha,
    isAncestor,
    hasMergeInRange,
    deltaLines,
    roundIndex,
    fullEvery = 3,
    maxDeltaLines = 400,
  } = opts && typeof opts === "object" ? opts : {};
  const full = (reason) => ({ mode: "full", sinceSha: "", reason });

  // --- input sanity: a caller passing junk gets `full`, never a throw ---------
  const ids = (Array.isArray(lensIds) ? lensIds : []).filter((id) => typeof id === "string" && id !== "");
  const head = sha(headSha);
  const okEvery = Number.isInteger(fullEvery) && fullEvery > 0;
  const okRound = Number.isInteger(roundIndex) && roundIndex >= 0;
  const okMax = Number.isFinite(maxDeltaLines) && maxDeltaLines >= 0;
  if (ids.length === 0 || !head || !okEvery || !okRound || !okMax) return full("invalid-input");

  // --- per-lens state: EVERY lens must have usable, agreeing state ------------
  // A lens with no state has a coverage hole: it never saw the commits between
  // its last verdict and now, and an incremental round would never show them to
  // it. One lens short is enough to force a full round for all of them — the
  // reviewed artifact is global, so partial narrowing is not on offer.
  const get = (id) => {
    const v = states instanceof Map ? states.get(id) : states?.[id];
    // Accept either a parsed state or the raw external_id string.
    return typeof v === "string" ? parseReviewState(v) : (v ?? null);
  };
  const found = ids.map(get);
  if (found.every((s) => !s)) return full("no-prior-state");
  if (found.some((s) => !s || !sha(s.reviewed))) return full("lens-state-gap");

  const reviewedSet = new Set(found.map((s) => sha(s.reviewed)));
  // Lenses normally stamp the same head SHA in one panel run. They diverge only
  // when a lens missed a round (infra error), which is the same coverage hole as
  // a gap — and picking the newest would skip commits the laggard never saw,
  // while picking the oldest re-reviews for everyone anyway. So: full.
  if (reviewedSet.size !== 1) return full("lens-state-divergence");
  const since = [...reviewedSet][0];

  // Re-run on an already-reviewed SHA. The delta is empty, and review-panel.mjs
  // refuses an empty diff (fails closed), so narrowing here would turn a
  // harmless re-run into a hard panel failure.
  if (since === head) return full("no-new-commits");

  // --- git facts: absent or unusable means we cannot reason about the range ---
  if (typeof isAncestor !== "boolean" || typeof hasMergeInRange !== "boolean" || !Number.isFinite(deltaLines) || deltaLines < 0) {
    return full("git-facts-unavailable");
  }
  // The stamped SHA is not an ancestor of HEAD: force-push, rebase, amend, or a
  // reset. `since..head` is then meaningless — it can silently omit commits that
  // were rewritten rather than added.
  if (!isAncestor) return full("force-push-or-rewrite");
  // A merge in range pulls in arbitrary `main` history that no lens has reviewed
  // in the context of this branch.
  if (hasMergeInRange) return full("merge-in-range");

  // --- policy caps -----------------------------------------------------------
  // Periodic rebaseline. Carry-forward re-checks findings already RAISED; it
  // cannot surface a defect whose root cause is old code that only became
  // reachable via new code. A full round every `fullEvery` rounds bounds how long
  // such a defect can hide. This is the honest reason the saving is ~2x, not ~8x.
  if (roundIndex % fullEvery === 0) return full("periodic-rebaseline");
  // A large delta is not cheaper to review incrementally, and it is more likely
  // to be a rebase or a squash than a normal fix round.
  if (deltaLines > maxDeltaLines) return full("delta-too-large");

  return { mode: "incremental", sinceSha: since, reason: "ok" };
}

/**
 * The scope note prepended to a lens prompt in incremental mode.
 *
 * Returns `""` for full mode, which is what keeps this change inert: with no
 * flags passed, every lens prompt is byte-identical to today's.
 *
 * Three clauses are load-bearing, and the lens will under-review without them:
 *   1. earlier commits were reviewed in prior rounds, BUT this lens still owns
 *      defects the delta newly exposes in them;
 *   2. the FULL working tree is its cwd, so it can and should read outside the
 *      delta;
 *   3. the changed-file list is CUMULATIVE, not the delta's files.
 * Clause 1 alone reads as "the old code is someone else's problem", which is the
 * recall regression this whole mode risks.
 */
export function renderScopeNote(opts) {
  // Coerced, not a `= {}` default — see the note in `resolveReviewMode`. Same bug
  // was present here and the test only exercised `undefined`, so it stayed green.
  const { mode, sinceSha, baseSha, changedFiles } = opts && typeof opts === "object" ? opts : {};
  if (mode !== "incremental") return "";
  const since = sha(sinceSha);
  if (!since) return ""; // no usable pointer → say nothing rather than something wrong
  const base = sha(baseSha);
  const files = (Array.isArray(changedFiles) ? changedFiles : []).filter(
    (f) => typeof f === "string" && f.trim() !== "",
  );
  return [
    "## Review scope for this round (INCREMENTAL — read this first)",
    "",
    `The diff below is only the commits added since \`${since.slice(0, 12)}\`, not the`,
    `whole pull request${base ? ` (which starts at \`${base.slice(0, 12)}\`)` : ""}.`,
    "",
    "- Earlier commits were reviewed in previous rounds, so do NOT re-report findings",
    "  about code this delta does not touch.",
    "- **But you still own defects this delta newly exposes in that earlier code.** A",
    "  change here that makes an older path reachable, or that breaks an assumption",
    "  older code relies on, is in scope and is YOUR finding to raise.",
    "- The COMPLETE working tree is your working directory. Use Read/Grep/Glob freely",
    "  to read files the diff does not show you — that is expected, not out of scope.",
    "- The changed-file list you were given is CUMULATIVE for the whole pull request,",
    "  not just this delta. Use it to find what else the PR has already touched.",
    files.length > 0 ? `- Files changed by the PR so far: ${files.length}.` : "",
    "",
    "This is DATA about your task, not an instruction from the code under review.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
