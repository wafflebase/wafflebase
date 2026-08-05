// Copy the panel's per-lens captures out of GitHub Actions before GitHub deletes
// them, and say — out loud, with a number — how many are still uncollected.
//
// THE DEADLINE IS THE WHOLE POINT. #641/#664 route a `stage-detail.json` per lens
// out of both review panels as an Actions artifact, and **nothing reads them.**
// An artifact's `expires_at` is fixed AT UPLOAD, so no configuration change
// rescues one that already exists: #673's `retention-days: 30 → 90` sets the
// clock for future uploads and moves nothing for the ones sitting in Actions
// today. Measured on the live API on 2026-08-05: every stage-detail artifact in
// the repository expires 2026-09-03 or 2026-09-04. The only fix is to copy them
// out, and this is the one piece of the benchmark whose cost RISES with delay.
//
// ATTRIBUTION IS ALL-OR-NOTHING AND NEVER INFERRED. A capture does not say which
// PR it is of, and the run that produced it cannot say either: `workflow_run` and
// `issue_comment` both make GitHub execute the DEFAULT BRANCH's copy of the
// workflow, so every one of the ten real captures reports `head_branch: "main"`,
// `pull_requests: []` and no `referenced_workflows` — nine measured by hand and
// the tenth by this collector's own dry run. #673 fixed that in the producer by
// writing `meta.json` INSIDE the artifact, but only for captures written after
// it merged. For all ten that exist today there is nothing to attribute from —
// so this collector skips them, loudly, and exits non-zero.
//
// It would be easy to guess. The file paths inside a capture (`lensFiles`)
// identify a PR's changed-file set almost uniquely, and a human has in fact used
// them to attribute seven of the ten by hand. **The collector may not.** A
// capture filed against the wrong PR corrupts the corpus in a way no later check
// would notice; a missing one is visible. Absence is the recoverable failure.
//
// WHERE THIS RUNS, AND WHERE THE DATA GOES.
// `.github/workflows/capture-collect.yml` runs it with `--write` on
// `workflow_run` from both producers, plus a nightly sweep and a manual button.
//
// The store is NOT in this repository. The design's Option C was a bucket and
// there is no bucket yet; spec §8's interim answer was a folder here, and that
// fails twice over — a job that writes here needs `contents: write`, the exact
// boundary #641 refused to cross for this subsystem, and git history is
// permanent, so data committed here while the storage question is still open
// could never be taken back out. So the store is a folder in the separate eval
// repo and `--root` names it explicitly; `capture-store.mjs` deliberately has no
// default, because a forgotten flag must not be able to write here.
//
// The workflow's own permissions are `{actions: read, contents: read}` and the
// write capability is a fine-grained token scoped to that other repository, so
// nothing this file does widens what CI can do to `wafflebase`. When the bucket
// exists this becomes Option C: the checkouts and the commit collapse into
// `id-token: write` plus a PUT, and the store gains a second implementation. The
// key scheme is unchanged either way, so the migration is `aws s3 sync`.
//
// COLLECTING NOTHING LOOKS EXACTLY LIKE HAVING NOTHING TO COLLECT. This subsystem
// has failed silently three times — the upload logged "No files were found" for
// five rounds, the novelty gate printed `OFF` and nothing read it, and the
// upload glob would have matched no `meta.json` at all. Every count below is
// therefore printed even when it is zero, and every skip that should not happen
// exits non-zero. A red X in the Actions tab is the cheapest monitor available.
//
// FAIL DIRECTION. The read paths degrade: one unreadable artifact costs that
// artifact, one unparseable lens file costs that file and not its four healthy
// siblings. The single write path (`putCapture`) refuses on any doubt and is
// write-once, so a retry, a race and a wide re-scan are the same operation.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./gh-checks.mjs";
import { createCaptureStore } from "./capture-store.mjs";

// --- the producer contract ----------------------------------------------------
//
// RE-EXPORTED FROM THE PRODUCER, not restated. `capture-meta.mjs` (#673) writes
// the file this module reads, so the schema string, the file name and the
// channel list have exactly one definition and the two sides cannot drift. This
// codebase has paid for the alternative: the upload glob came to match no
// `meta.json` at all because a rule was re-derived instead of reused, and it
// stayed silent for five rounds.
//
// The VALIDATORS below are deliberately NOT shared, and that is a different
// question from the constants. A consumer that trusts the producer's own
// validator cannot detect a producer that validates wrongly, and this one also
// has to accept a hand-written backfill `meta.json` that never went through
// `buildCaptureMeta`. So: one definition of what the contract IS, two
// independent implementations of checking it. `collect-captures.test.mjs` runs
// the producer's real `buildCaptureMeta` output through `parseMeta`, which is
// what keeps the second implementation honest.
//
// Importing is safe: `capture-meta.mjs` guards its CLI behind the
// `import.meta.url` check, so nothing runs on import.

// Imported AND re-exported, not `export … from`: a bare re-export creates no
// local binding, and every validator below reads these.
import { CAPTURE_META_SCHEMA, CAPTURE_META_FILE, CAPTURE_CHANNELS } from "./capture-meta.mjs";
export { CAPTURE_META_SCHEMA, CAPTURE_META_FILE, CAPTURE_CHANNELS };

/**
 * Both producers upload under this stem, and #673 appends `-pr-<n>` from a
 * `${{ }}` expression. Matched by PREFIX for that reason: the suffix is a
 * runtime value, so there is no literal to compare against.
 *
 * Not in `capture-meta.mjs` because the producer does not own it — the artifact
 * NAME is set in the two workflow files, and `meta.json` is the source of truth
 * for everything the name hints at. A test reads both `name:` lines out of the
 * real workflows and pins them to this prefix.
 */
export const CAPTURE_ARTIFACT_PREFIX = "review-panel-stage-detail";

// --- validation ---------------------------------------------------------------

const SHA40 = /^[0-9a-f]{40}$/;
// A positive integer with no leading zeros, sign, whitespace or decimal point.
// Deliberately stricter than `Number()`: `pr`, `runId` and `runAttempt` become
// KEY SEGMENTS, and a value that survives coercion but not this regex ("1e3",
// " 12", "../..") is exactly how a path escapes its prefix.
const POSITIVE_INT = /^[1-9][0-9]*$/;
const LENS_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WORKFLOW_FILE = /^[A-Za-z0-9._-]+\.ya?ml$/;
const EVENT_NAME = /^[a-z][a-z_]*$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
/** `<lens>/stage-detail.json`, and nothing else, anywhere in the zip. */
const LENS_ENTRY = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/stage-detail\.json$/;

/** Every refusal names the field and the offending value, so the log line names the fix. */
function refuse(field, value, expected) {
  const shown = typeof value === "string" ? JSON.stringify(value.slice(0, 80)) : JSON.stringify(value);
  throw new Error(`capture meta: ${field} must be ${expected}, got ${shown}`);
}

function requireMatch(field, value, re, expected) {
  if (typeof value !== "string" || !re.test(value)) refuse(field, value, expected);
  return value;
}

/** A count that may arrive as a JSON number or a string, kept as a NUMBER. */
function requireCount(field, value) {
  const s = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  requireMatch(field, s, POSITIVE_INT, "a positive integer");
  return Number(s);
}

/**
 * `meta.json` → the validated facts, or a throw naming the field that failed.
 *
 * THROWS rather than returning `{ok: false}` on purpose: every caller's response
 * to an unvalidatable field is the same — skip the whole capture — and the
 * exception carries the field name into the log for free. Partial trust is not
 * an option the design allows (invariant E), so there is no shape for "valid
 * except for `baseSha`".
 *
 * Accepts the raw file text or an already-parsed object, because the caller has
 * bytes and the tests have literals. Unparseable text is a refusal like any
 * other, named as such.
 *
 * Returns ONLY the validated fields, and that narrowing is safe here for one
 * specific reason: the collector stores `meta.json` VERBATIM, so nothing a
 * future producer adds is lost by this function not knowing about it. (Contrast
 * the finding adapters, where narrowing to a field list has silently dropped
 * annotations twice — "adapters widen, never narrow". A validator is not an
 * adapter, and the verbatim copy is what makes the difference.)
 */
export function parseMeta(json) {
  let m = json;
  if (typeof json === "string" || Buffer.isBuffer(json)) {
    try {
      m = JSON.parse(String(json));
    } catch (e) {
      throw new Error(`capture meta: not valid JSON (${e.message})`);
    }
  }
  if (m === null || typeof m !== "object" || Array.isArray(m)) refuse("meta", m, "a JSON object");

  // Schema FIRST, and by major version, so an unrecognised format is refused
  // before any field is read. A collector that guesses at a format it does not
  // know writes plausible garbage into the corpus, which no later check catches.
  const schema = typeof m.schema === "string" ? m.schema : "";
  const at = schema.lastIndexOf("@");
  const name = at < 0 ? schema : schema.slice(0, at);
  const major = at < 0 ? "" : schema.slice(at + 1);
  const [wantName, wantMajor] = [CAPTURE_META_SCHEMA.slice(0, CAPTURE_META_SCHEMA.lastIndexOf("@")), CAPTURE_META_SCHEMA.slice(CAPTURE_META_SCHEMA.lastIndexOf("@") + 1)];
  if (name !== wantName || major !== wantMajor) refuse("schema", m.schema, `${CAPTURE_META_SCHEMA} (major ${wantMajor})`);

  if (!CAPTURE_CHANNELS.includes(m.channel)) refuse("channel", m.channel, `one of ${CAPTURE_CHANNELS.join(" | ")}`);
  if (!Array.isArray(m.lenses) || m.lenses.length === 0) refuse("lenses", m.lenses, "a non-empty array of lens slugs");
  for (const lens of m.lenses) requireMatch("lenses[]", lens, LENS_SLUG, "a lowercase kebab-case slug");

  // `null`, not omitted and not `""`. The diff base is legitimately unknown when
  // the diff step never ran; a MALFORMED one is a refusal. The producer writes
  // exactly this distinction and a consumer that collapsed the two would lose it.
  const baseSha = m.baseSha === undefined || m.baseSha === null
    ? null
    : requireMatch("baseSha", m.baseSha, SHA40, "40 lowercase hex characters or null");

  return {
    schema: m.schema,
    pr: requireCount("pr", m.pr),
    headSha: requireMatch("headSha", m.headSha, SHA40, "40 lowercase hex characters"),
    baseSha,
    channel: m.channel,
    workflow: requireMatch("workflow", m.workflow, WORKFLOW_FILE, "a workflow file name ending in .yml"),
    runId: requireCount("runId", m.runId),
    runAttempt: requireCount("runAttempt", m.runAttempt),
    event: requireMatch("event", m.event, EVENT_NAME, "a GitHub event name"),
    panelSha: requireMatch("panelSha", m.panelSha, SHA40, "40 lowercase hex characters"),
    lenses: [...m.lenses],
    capturedAt: requireMatch("capturedAt", m.capturedAt, ISO_UTC, "an ISO 8601 UTC timestamp ending in Z"),
  };
}

/** The store prefix, kept so the S3 migration is `s3://<bucket>/` + this. */
const KEY_ROOT = "stage-detail";

/**
 * Nothing may leave `keyFor` that does not match this. A whole-key assertion
 * rather than trust in the five field checks above: it is the one place that
 * sees the assembled string, and it costs one regex to make "a key is always
 * this shape" a fact rather than a convention.
 */
const KEY_SHAPE = new RegExp(
  `^${KEY_ROOT}/channel=(?:${CAPTURE_CHANNELS.join("|")})/pr=[1-9][0-9]*/sha=[0-9a-f]{8}/run=[1-9][0-9]*/attempt=[1-9][0-9]*/(?:${CAPTURE_META_FILE.replace(".", "\\.")}|[a-z0-9]+(?:-[a-z0-9]+)*\\.json)$`,
);

/**
 * Where one file of one capture is stored. `lens = null` gives `meta.json`.
 *
 * INVARIANT A — keys are assembled only from validated primitives. Every
 * component is re-checked HERE even though `parseMeta` already checked it,
 * because this function is the one that concatenates, and a key built from an
 * object that never went through `parseMeta` (a raw `JSON.parse`, a test
 * fixture, a future caller) must fail rather than write outside the store. A
 * `pr` of `"../../.."` is not hypothetical: `meta.json` travels out of a runner
 * that processed untrusted branch content.
 *
 * INVARIANT B — `run=` and `attempt=` are IN the key, which is the load-bearing
 * decision in the whole design. A key identifies one execution, so re-running
 * the collector, two collectors racing and a wide re-scan are the same harmless
 * operation, and retry safety, concurrency safety and sweep design stop being
 * three separate problems. It is also what keeps #648's and #632's two gating
 * rounds — same PR, same files, ~17h apart — as two measurements rather than
 * one.
 *
 * The layout follows the S3 design's §7 key scheme so the migration is a path
 * transform: `key=value` components in the same order (`channel`, `pr`, `sha`,
 * `run`), which is the partition convention Athena and friends expect. Two
 * deliberate resolutions of that section: `attempt=` is its own component
 * because §7's example omitted it while invariant B requires it, and it is a
 * partition like the others; and `sha=` keeps §7's 8-character prefix — the full
 * sha is in the stored `meta.json`, and `run=` already makes the key unique, so
 * the short form is a human convenience that costs nothing.
 */
export function keyFor(meta, lens = null) {
  const channel = meta === null || typeof meta !== "object" ? refuse("meta", meta, "an object") : meta.channel;
  if (!CAPTURE_CHANNELS.includes(channel)) refuse("channel", channel, `one of ${CAPTURE_CHANNELS.join(" | ")}`);
  const pr = requireCount("pr", meta.pr);
  const sha = requireMatch("headSha", meta.headSha, SHA40, "40 lowercase hex characters").slice(0, 8);
  const runId = requireCount("runId", meta.runId);
  const attempt = requireCount("runAttempt", meta.runAttempt);
  const file = lens === null || lens === undefined
    ? CAPTURE_META_FILE
    : `${requireMatch("lens", lens, LENS_SLUG, "a lowercase kebab-case slug")}.json`;

  const key = `${KEY_ROOT}/channel=${channel}/pr=${pr}/sha=${sha}/run=${runId}/attempt=${attempt}/${file}`;
  if (!KEY_SHAPE.test(key)) refuse("key", key, `of the form ${KEY_SHAPE.source}`);
  return key;
}

/**
 * The producing run ids already in the store, read back OUT of the keys.
 *
 * This is what lets the read-only expiry warning work at all. It cannot open an
 * artifact to learn which PR it belongs to — that needs a download and the job
 * deliberately has no reason to do one — but the artifact LIST gives
 * `workflow_run.id`, and invariant B put that same id in every key. So "is this
 * artifact collected?" is answerable from two read-only listings and no
 * attribution guess.
 */
export function runIdsFromKeys(keys) {
  const ids = new Set();
  for (const key of Array.isArray(keys) ? keys : []) {
    const m = /(?:^|\/)run=([1-9][0-9]*)(?:\/|$)/.exec(typeof key === "string" ? key : "");
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

/**
 * Which zip entries may be read, and why each of the others may not.
 *
 * The artifact crosses a trust boundary — it was assembled by a runner that
 * processed the branch under review — so the zip is untrusted input and its
 * entry names are validated against a whitelist rather than sanitised. `../`,
 * absolute paths, backslash paths, NUL bytes and anything that is not exactly
 * `meta.json` or `<lens>/stage-detail.json` are rejected by NAME, before any
 * byte is read.
 *
 * Duplicates are rejected too, and that one is not obvious: a zip may carry the
 * same entry name twice, and the second copy is what an extractor writing to
 * disk would leave behind. Reading only the first and refusing the rest removes
 * the ambiguity entirely.
 *
 * A directory entry gets its own reason. `unzip -Z1` lists them on some archives
 * and they are entirely benign, so lumping them in with `../` would make a
 * routine listing look like an attack and train a reader to ignore the line that
 * matters.
 */
export function safeEntries(names) {
  const entries = [];
  const rejected = [];
  const seen = new Set();
  for (const raw of Array.isArray(names) ? names : []) {
    if (typeof raw !== "string" || raw === "") { rejected.push({ name: String(raw), reason: "not-a-name" }); continue; }
    const name = raw;
    if (seen.has(name)) { rejected.push({ name, reason: "duplicate-entry" }); continue; }
    seen.add(name);
    if (name === CAPTURE_META_FILE) { entries.push({ name, kind: "meta", lens: null }); continue; }
    const m = LENS_ENTRY.exec(name);
    if (m) { entries.push({ name, kind: "lens", lens: m[1] }); continue; }
    rejected.push({ name, reason: rejectReason(name) });
  }
  return { entries, rejected };
}

/**
 * Named reasons, so the log distinguishes "odd" from "hostile".
 *
 * EVERY HOSTILE SHAPE IS TESTED BEFORE `directory-entry`, and the order is the
 * whole correctness of this function. A trailing slash is the most superficial
 * property a name has — `../` and `/etc/` have one too — so classifying on it
 * first would file a traversal attempt under the one reason the caller treats as
 * benign, and the artifact would carry on being collected with the alarm
 * silenced. Benign-looking beats hostile only when hostile has already been
 * ruled out.
 */
function rejectReason(name) {
  if (name.includes("\0")) return "nul-byte";
  if (name.startsWith("/") || /^[A-Za-z]:[\\/]/.test(name)) return "absolute-path";
  if (name.includes("\\")) return "backslash-path";
  if (name.split("/").some((s) => s === ".." || s === ".")) return "path-traversal";
  if (name.endsWith("/")) return "directory-entry";
  return "unexpected-name";
}

/** The reasons that mean someone built a hostile artifact, not a scruffy one. */
const HOSTILE_ENTRY_REASONS = new Set(["nul-byte", "absolute-path", "backslash-path", "path-traversal"]);
export const isHostileEntry = (reason) => HOSTILE_ENTRY_REASONS.has(reason);

// --- planning ------------------------------------------------------------------

/**
 * Default sweep window. Wide enough that a collector broken for a week loses
 * nothing (the artifacts live 30–90 days), narrow enough that a routine run
 * downloads a handful of zips.
 */
export const DEFAULT_SINCE_DAYS = 7;

/**
 * Caps, and every one of them logs exactly what it dropped (invariant F).
 * Silent truncation is the failure mode that reads as "everything was collected"
 * when it was not — the same trap that hid the original capture bug for five
 * rounds.
 */
export const MAX_ARTIFACTS = 200;
export const MAX_FILES_PER_ARTIFACT = 32;
/** ~60 KB is a whole capture today; 8 MB is headroom for `STAGE_DETAIL_DIFF_CONTENT`. */
export const MAX_BYTES_PER_FILE = 8 * 1024 * 1024;

/** Milliseconds, or `null` — never a string comparison. ISO strings with an offset sort wrong. */
const instant = (s) => {
  const t = Date.parse(typeof s === "string" ? s : "");
  return Number.isFinite(t) ? t : null;
};

/**
 * What to fetch, what to skip and why — pure, so every rule below is a unit test
 * rather than an integration run.
 *
 * `artifacts` is one flat newest-first list as the API returns it. Non-capture
 * artifacts are COUNTED rather than listed: the repository holds 3809 artifacts
 * (measured 2026-08-05) and a per-item skip record for each would bury the ten
 * that matter.
 *
 * A name that starts with the prefix but is not one of the two known exact forms
 * is still fetched, and reported. Failing toward "collect it" is deliberate: if
 * a future producer renames the artifact, a strict matcher would collect nothing
 * and say nothing, which is precisely this subsystem's signature failure.
 */
export function planCollection(artifacts, opts = {}) {
  const {
    now = null,
    since = null,
    prefix = CAPTURE_ARTIFACT_PREFIX,
    maxArtifacts = MAX_ARTIFACTS,
  } = opts;
  const sinceAt = since instanceof Date ? since.getTime() : instant(since);
  const known = new RegExp(`^${prefix}(?:-pr-[1-9][0-9]*)?$`);

  const fetch = [];
  const skipped = [];
  const unexpectedNames = [];
  let ignored = 0;

  for (const a of Array.isArray(artifacts) ? artifacts : []) {
    const name = typeof a?.name === "string" ? a.name : "";
    if (!name.startsWith(prefix)) { ignored++; continue; }
    if (!known.test(name)) unexpectedNames.push(name);

    const createdAt = instant(a?.created_at);
    if (createdAt === null) { skipped.push({ id: a?.id, name, reason: "bad-created-at", detail: String(a?.created_at) }); continue; }
    if (sinceAt !== null && createdAt < sinceAt) { skipped.push({ id: a?.id, name, reason: "older-than-since", detail: a.created_at }); continue; }
    // Before the download, not after: the list already told us, and a download of
    // an expired artifact is a 410 we paid a request to learn.
    if (a?.expired === true) { skipped.push({ id: a?.id, name, reason: "expired", detail: a?.expires_at ?? "" }); continue; }
    fetch.push({
      id: a?.id,
      name,
      runId: Number(a?.workflow_run?.id) || null,
      createdAt: a.created_at,
      expiresAt: a?.expires_at ?? null,
      sizeBytes: Number(a?.size_in_bytes) || 0,
      // Days remaining, for the log line. `now` is injected — a pure function
      // with a clock in it is not pure, and this one is unit-tested at fixed
      // instants.
      daysLeft: daysBetween(now, a?.expires_at),
    });
  }

  // The cap drops the OLDEST first: the list is newest-first, so the tail is both
  // the least urgent and the most likely to be already collected.
  let dropped = null;
  if (fetch.length > maxArtifacts) {
    const cut = fetch.splice(maxArtifacts);
    dropped = {
      count: cut.length,
      cap: maxArtifacts,
      oldest: cut[cut.length - 1]?.createdAt ?? null,
      newest: cut[0]?.createdAt ?? null,
      ids: cut.map((c) => c.id),
    };
  }

  return { fetch, skipped, ignored, unexpectedNames, dropped };
}

/** Whole days from `now` to `at`, or `null` if either is unknown. Never string maths. */
export function daysBetween(now, at) {
  const a = now instanceof Date ? now.getTime() : instant(now);
  const b = instant(at);
  if (a === null || b === null) return null;
  return Math.floor((b - a) / 86400000);
}

// --- pagination ------------------------------------------------------------------

/** GitHub's maximum for this endpoint. Asking for more is clamped, not an error. */
export const ARTIFACT_PAGE_SIZE = 100;
/** A backstop, not a policy: 3809 artifacts is 39 pages, and this is 100. */
export const MAX_ARTIFACT_PAGES = 100;

/**
 * Walk the artifact list newest-first and STOP at the first page whose last item
 * predates `since`.
 *
 * This is what makes the collector's work bounded by the window rather than by
 * the repository's history. There are 3809 artifacts (measured 2026-08-05); a
 * `--paginate` of the whole list is 33+ requests to find the ten that matter,
 * every night, forever. The list is ordered by `created_at` descending, so the
 * first item older than the window means every remaining item is too.
 *
 * `fetchPage` is injected — the tests drive it with a fake page sequence, so the
 * early stop is proved rather than assumed, and no test touches the network.
 *
 * Fails toward FEWER records: a page that cannot be read ends the walk with what
 * is already in hand rather than throwing, because the artifacts stay alive for
 * their retention window and the next run retries. It is reported, so a run that
 * saw half the window does not read as a run that saw all of it.
 */
export function walkArtifacts({ fetchPage, since = null, pageSize = ARTIFACT_PAGE_SIZE, maxPages = MAX_ARTIFACT_PAGES, log = () => {} }) {
  const sinceAt = since instanceof Date ? since.getTime() : instant(since);
  const all = [];
  let pages = 0;
  let stoppedEarly = false;
  let truncated = false;
  let failed = null;

  for (let page = 1; page <= maxPages; page++) {
    let items;
    try {
      items = fetchPage(page, pageSize);
    } catch (e) {
      failed = `page ${page}: ${e.message}`;
      log(`collect-captures: could not read artifact page ${page} (${e.message}); walked ${pages} page(s) and stopping there.`);
      break;
    }
    const list = Array.isArray(items) ? items : [];
    pages++;
    all.push(...list);
    // A short page is the last page — GitHub returns exactly `pageSize` until it
    // runs out. Checked before the `since` test so an exactly-full final page
    // does not cost one wasted request.
    if (list.length < pageSize) break;
    if (sinceAt !== null) {
      const last = instant(list[list.length - 1]?.created_at);
      if (last !== null && last < sinceAt) { stoppedEarly = true; break; }
    }
    if (page === maxPages) truncated = true;
  }

  if (truncated) {
    log(`collect-captures: stopped at the ${maxPages}-page cap with ${all.length} artifact(s) read and MORE remaining. Narrow --since, or raise the cap.`);
  }
  return { artifacts: all, pages, stoppedEarly, truncated, failed };
}

// --- the summary, and the exit code ------------------------------------------------

/**
 * Reasons a skip is a PROBLEM rather than routine. §9.3: exit non-zero when a
 * capture was skipped for a reason that should not happen, because a red X in
 * the Actions tab is the cheapest monitor available.
 *
 * `no-meta` is on this list even though EVERY capture in existence today lacks
 * `meta.json` — that is the point. Before #673 lands the collector exits 1 on
 * every run and says why, which is a collector correctly refusing to guess, not
 * a broken one. After it lands, the same non-zero means a producer regressed.
 */
const LOUD_SKIPS = new Set([
  "no-meta", "bad-meta", "unsafe-entries", "expired", "download-failed", "bad-created-at", "no-lens-files",
]);
export const isLoudSkip = (reason) => LOUD_SKIPS.has(reason);

const kb = (n) => `${Math.round(n / 1024)} KB`;

/**
 * The one-line report and the exit-code rule, together in a pure function
 * because they are the same decision: what the run says and whether it is red
 * must not be able to disagree.
 *
 * Every count is printed even when it is zero. "0 collected" is either fine or
 * an emergency and the only way to tell them apart is to look — printing the
 * number is what makes the question askable.
 */
export function summarize(results) {
  const r = results ?? {};
  const skipped = Array.isArray(r.skipped) ? r.skipped : [];
  const byReason = new Map();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  const reasons = [...byReason.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));

  const collected = Number(r.collected) || 0;
  const files = Number(r.files) || 0;
  const bytes = Number(r.bytes) || 0;
  const present = Number(r.present) || 0;
  const scanned = Number(r.scanned) || 0;
  const verb = r.dryRun ? "would collect" : "collected";

  const parts = [
    `${verb} ${collected} capture(s), ${files} file(s), ${kb(bytes)}`,
    `${present} already present`,
    skipped.length === 0
      ? "0 skipped"
      : `${skipped.length} skipped (${reasons.map(([reason, n]) => `${n} ${reason}`).join(", ")})`,
    `${scanned} capture artifact(s) scanned`,
  ];
  // Named in the line and counted in the exit code. A dropped file is data that
  // existed and was not collected — the artifact expires regardless — so it is
  // the same class of event as a skipped capture, only smaller.
  const droppedFiles = Array.isArray(r.droppedFiles) ? r.droppedFiles : [];
  if (droppedFiles.length > 0) {
    const byFileReason = new Map();
    for (const d of droppedFiles) byFileReason.set(d.reason, (byFileReason.get(d.reason) ?? 0) + 1);
    parts.push(`DROPPED ${droppedFiles.length} file(s) (${[...byFileReason.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).map(([reason, n]) => `${n} ${reason}`).join(", ")})`);
  }
  if (r.dropped) parts.push(`DROPPED ${r.dropped.count} by the ${r.dropped.cap}-artifact cap (${r.dropped.oldest} … ${r.dropped.newest})`);
  if (Array.isArray(r.partial) && r.partial.length > 0) parts.push(`${r.partial.length} capture(s) had fewer lens files than meta.json lists`);

  const loud = skipped.filter((s) => isLoudSkip(s.reason));
  const exitCode = loud.length > 0 || droppedFiles.length > 0 || r.dropped || r.walkFailed || r.walkTruncated ? 1 : 0;

  return {
    line: `collect-captures: ${parts.join(" · ")}`,
    exitCode,
    loudSkips: loud.length,
    droppedFiles: droppedFiles.length,
    byReason: Object.fromEntries(reasons),
  };
}

// --- the expiry warning (read-only) --------------------------------------------------

/** Warn this far ahead. Long enough that a week of nobody looking is still recoverable. */
export const DEFAULT_WARN_DAYS = 14;

/**
 * How many captures are uncollected, and how close they are to dying. Pure.
 *
 * Read-only by construction: it compares the artifact LIST against the run ids
 * already in the store and never opens an artifact, which is why the scheduled
 * job needs nothing beyond `{actions: read, contents: read}`.
 *
 * The count is reported whether it is zero or not. This function exists because
 * "nobody notices it is broken" is the design's stated residual risk, and an
 * uncollected count that is only printed when it is interesting is a count
 * nobody can act on.
 */
export function expiryReport(artifacts, collectedRunIds, opts = {}) {
  const { now = null, warnWithinDays = DEFAULT_WARN_DAYS, prefix = CAPTURE_ARTIFACT_PREFIX } = opts;
  const collected = collectedRunIds instanceof Set ? collectedRunIds : new Set(collectedRunIds ?? []);

  const captures = (Array.isArray(artifacts) ? artifacts : []).filter((a) => typeof a?.name === "string" && a.name.startsWith(prefix));
  const rows = captures.map((a) => ({
    id: a?.id,
    name: a.name,
    runId: Number(a?.workflow_run?.id) || null,
    expiresAt: a?.expires_at ?? null,
    expired: a?.expired === true,
    daysLeft: daysBetween(now, a?.expires_at),
    collected: collected.has(Number(a?.workflow_run?.id)),
  }));

  const uncollected = rows.filter((r) => !r.collected && !r.expired);
  // `daysLeft === null` counts as urgent: an expiry we could not read is not an
  // expiry we may assume is far away.
  const urgent = uncollected.filter((r) => r.daysLeft === null || r.daysLeft <= warnWithinDays);
  const alreadyExpired = rows.filter((r) => r.expired && !r.collected);
  const soonest = uncollected.reduce((m, r) => (r.daysLeft !== null && (m === null || r.daysLeft < m) ? r.daysLeft : m), null);

  const lines = [
    `capture-expiry: ${rows.length} stage-detail artifact(s) known · ${rows.length - uncollected.length - alreadyExpired.length} already collected · ${uncollected.length} UNCOLLECTED · ${alreadyExpired.length} expired uncollected`,
    uncollected.length === 0
      ? `capture-expiry: 0 uncollected. Either everything is collected, or no review has run — check that reviews are still producing captures.`
      : `capture-expiry: soonest uncollected expiry in ${soonest === null ? "unknown" : soonest} day(s); ${urgent.length} within ${warnWithinDays} day(s).`,
  ];
  for (const r of urgent) {
    lines.push(`capture-expiry:   run ${r.runId ?? "?"} (${r.name}) expires ${r.expiresAt} — ${r.daysLeft === null ? "unknown" : r.daysLeft} day(s) left`);
  }
  if (alreadyExpired.length > 0) {
    lines.push(`capture-expiry: ${alreadyExpired.length} artifact(s) have ALREADY expired uncollected — that data is gone.`);
  }

  return {
    total: rows.length,
    uncollected,
    urgent,
    alreadyExpired,
    soonest,
    lines,
    exitCode: urgent.length > 0 || alreadyExpired.length > 0 ? 1 : 0,
  };
}

// --- the injected side effects ---------------------------------------------------

/** One `gh api` call, parsed. The same shape `gh-checks.mjs` injects. */
function ghJson(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
}

/**
 * Download, list, read. The three operations that touch the outside world, in
 * one object so a test replaces all of them at once and needs no network, no fs
 * and no zip.
 *
 * The extractor never writes an archive member to disk. `unzip -p` streams one
 * NAMED entry to stdout, so even if `safeEntries` had a hole, a `../` member has
 * no path to travel along — the untrusted zip is read, never unpacked. That is
 * defence in depth rather than the primary control, and it is worth the awkward
 * shape: an `unzip -d` into a temp directory would make the entry-name whitelist
 * the only thing standing between an artifact and the filesystem.
 */
export function ghArtifactIo({ repo = null, keep = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "wb-captures-"));
  const slug = repo ? `${repo}/` : "{owner}/{repo}/";
  const zipPath = (id) => path.join(dir, `artifact-${id}.zip`);

  return {
    listPage(page, perPage) {
      const res = ghJson(["api", `repos/${slug.replace(/\/$/, "")}/actions/artifacts?per_page=${perPage}&page=${page}`]);
      return Array.isArray(res?.artifacts) ? res.artifacts : [];
    },
    download(id) {
      const out = zipPath(id);
      // `gh api` follows the 302 to the signed URL and writes the zip to stdout.
      // `maxBuffer` is generous because a capture with `STAGE_DETAIL_DIFF_CONTENT`
      // on is megabytes rather than kilobytes.
      const buf = execFileSync("gh", ["api", `repos/${slug.replace(/\/$/, "")}/actions/artifacts/${id}/zip`], { maxBuffer: 256 * 1024 * 1024 });
      writeFileSync(out, buf);
      return out;
    },
    entries(zip) {
      const out = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
      return out.split("\n").map((s) => s.trim()).filter((s) => s !== "");
    },
    read(zip, name) {
      return execFileSync("unzip", ["-p", zip, name], { maxBuffer: 256 * 1024 * 1024 });
    },
    cleanup() {
      if (!keep) rmSync(dir, { recursive: true, force: true });
    },
    dir,
  };
}

// --- the collection itself ----------------------------------------------------

/**
 * One artifact → the files that should be written, or the reason it was skipped.
 *
 * PER-ARTIFACT ISOLATION (invariant D): every failure below is a `return`, never
 * a throw, so one malformed capture never aborts the batch. Inside it, per-FILE
 * isolation: one unreadable lens file is dropped and its healthy siblings are
 * kept, because `writeStageDetail` swallows its own errors by design and a
 * truncated file is genuinely possible.
 *
 * The lens payload is `JSON.parse`d and the result thrown away. That is the
 * whole inspection: a file that does not parse is not worth storing, and
 * anything beyond "does it parse" is the scorer's job. The collector is a mover.
 */
export function prepareArtifact(artifact, io, { maxFiles = MAX_FILES_PER_ARTIFACT, maxBytes = MAX_BYTES_PER_FILE, log = () => {} } = {}) {
  const skip = (reason, detail) => ({ ok: false, id: artifact.id, name: artifact.name, reason, detail });

  let zip;
  try {
    zip = io.download(artifact.id);
  } catch (e) {
    return skip("download-failed", e.message);
  }

  let names;
  try {
    names = io.entries(zip);
  } catch (e) {
    return skip("download-failed", `could not list entries: ${e.message}`);
  }

  const { entries, rejected } = safeEntries(names);
  for (const r of rejected) log(`collect-captures: artifact ${artifact.id} entry ${JSON.stringify(r.name)} rejected (${r.reason})`);
  // A hostile entry name condemns the WHOLE artifact, not just that entry. A zip
  // containing `../../etc/passwd` is not a capture with a typo; nothing else in
  // it is trustworthy either.
  const hostile = rejected.filter((r) => isHostileEntry(r.reason));
  if (hostile.length > 0) return skip("unsafe-entries", hostile.map((h) => `${h.reason}:${h.name}`).join(", "));

  const metaEntry = entries.find((e) => e.kind === "meta");
  if (!metaEntry) {
    // THE expected result on every capture written before #673. Not inferred
    // from `lensFiles`, not guessed from the run's timestamp: skipped.
    return skip("no-meta", `${entries.length} lens file(s) present but no ${CAPTURE_META_FILE}`);
  }

  // Read ONCE and keep the bytes: the stored copy is verbatim (see below), and
  // reading the entry a second time would let the file the collector validated
  // differ from the file it stored.
  let metaBytes;
  let meta;
  try {
    metaBytes = io.read(zip, metaEntry.name);
    meta = parseMeta(metaBytes);
  } catch (e) {
    return skip("bad-meta", e.message);
  }

  // The artifact list says which run produced the artifact; `meta.json` says
  // which run wrote the capture. They must agree — a mismatch means the file was
  // assembled somewhere other than where it claims, and the key would be built
  // from the wrong one of the two.
  if (artifact.runId !== null && artifact.runId !== meta.runId) {
    return skip("bad-meta", `meta.runId ${meta.runId} does not match the artifact's run ${artifact.runId}`);
  }

  const lensEntries = entries.filter((e) => e.kind === "lens");
  if (lensEntries.length === 0) {
    // Attribution for nothing. #673's producer cannot emit this (it writes no
    // meta.json when no lens captured), so seeing it means something else built
    // the artifact.
    return skip("no-lens-files", `${CAPTURE_META_FILE} present but no <lens>/stage-detail.json`);
  }

  // Stored VERBATIM. Re-serialising `parseMeta`'s output would silently drop any
  // field a future producer added, and this copy is the corpus's whole record of
  // provenance — the one file that must survive the round trip unchanged.
  const metaFile = { key: keyFor(meta, null), bytes: metaBytes, lens: null };

  const kept = [];
  const droppedFiles = [];
  for (const e of lensEntries.slice(0, maxFiles)) {
    let bytes;
    try {
      bytes = io.read(zip, e.name);
    } catch (err) {
      droppedFiles.push({ name: e.name, reason: "unreadable", detail: err.message });
      continue;
    }
    if (bytes.length > maxBytes) {
      droppedFiles.push({ name: e.name, reason: "too-large", detail: `${bytes.length} bytes > ${maxBytes}` });
      continue;
    }
    try {
      JSON.parse(String(bytes));
    } catch (err) {
      droppedFiles.push({ name: e.name, reason: "unparseable", detail: err.message });
      continue;
    }
    kept.push({ key: keyFor(meta, e.lens), bytes, lens: e.lens });
  }
  if (lensEntries.length > maxFiles) {
    for (const e of lensEntries.slice(maxFiles)) droppedFiles.push({ name: e.name, reason: "over-file-cap", detail: `cap ${maxFiles}` });
  }
  for (const d of droppedFiles) log(`collect-captures: artifact ${artifact.id} DROPPED ${d.name} (${d.reason}: ${d.detail})`);

  // Every lens file failed. Writing `meta.json` anyway would file an ATTRIBUTED
  // capture holding no measurement, which reads downstream as "the panel found
  // nothing" rather than "the copy did not work" — a corrupted data point rather
  // than an absent one. Absence is the recoverable failure, so refuse the whole
  // capture and let the next run retry while the artifact is still alive.
  if (kept.length === 0) {
    return skip("no-lens-files", `${lensEntries.length} lens entr(y|ies) present, none readable: ${droppedFiles.map((d) => `${d.name} (${d.reason})`).join(", ")}`);
  }

  // Fewer lens files than `meta.lenses` promises is recorded, not fatal: partial
  // data with a known gap is still data, and the gap is in the summary.
  const missing = meta.lenses.filter((l) => !kept.some((k) => k.lens === l));

  // `meta.json` LAST, and that ordering is load-bearing. The writes are separate
  // operations and a crash, a full disk or a permission fault can land between
  // any two of them. With `meta.json` first, an interrupted run leaves an
  // attributed capture with some or none of its lens files, and a consumer has no
  // way to tell that from a review that genuinely produced fewer findings.
  // Writing it last makes its presence in the store mean "this capture is
  // complete as collected" — the same rule the producer holds on the way out,
  // where #673 writes no `meta.json` unless a lens actually captured. Write-once
  // keys make the interrupted run's partial lens files free to re-collect.
  return { ok: true, id: artifact.id, name: artifact.name, meta, files: [...kept, metaFile], lensCount: kept.length, droppedFiles, missing };
}

/**
 * The whole run: walk, plan, prepare, write. Side effects injected; the decisions
 * all live in the pure functions above.
 */
export function collect({ io, store, since, now, dryRun = true, maxArtifacts = MAX_ARTIFACTS, log = console.error }) {
  const walk = walkArtifacts({ fetchPage: (page, perPage) => io.listPage(page, perPage), since, log });
  log(`collect-captures: read ${walk.pages} artifact page(s), ${walk.artifacts.length} artifact(s)${walk.stoppedEarly ? ` (stopped early at --since)` : ""}.`);

  const plan = planCollection(walk.artifacts, { now, since, maxArtifacts });
  log(`collect-captures: ${plan.fetch.length} capture artifact(s) in the window, ${plan.ignored} other artifact(s) ignored.`);
  for (const n of plan.unexpectedNames) log(`collect-captures: artifact name ${JSON.stringify(n)} matches the prefix but not a known form — collecting it anyway.`);
  if (plan.dropped) {
    log(`collect-captures: DROPPED ${plan.dropped.count} artifact(s) at the ${plan.dropped.cap}-artifact cap, created ${plan.dropped.oldest} … ${plan.dropped.newest}; ids ${plan.dropped.ids.join(",")}. Nothing is lost yet — re-run with a narrower --since.`);
  }
  for (const s of plan.skipped) log(`collect-captures: skipped ${s.name} (${s.id}) — ${s.reason}${s.detail ? `: ${s.detail}` : ""}`);

  const skipped = [...plan.skipped];
  const partial = [];
  const droppedFiles = [];
  let collected = 0;
  let files = 0;
  let bytes = 0;
  let present = 0;

  for (const artifact of plan.fetch) {
    const prepared = prepareArtifact(artifact, io, { log });
    if (!prepared.ok) {
      skipped.push({ id: prepared.id, name: prepared.name, reason: prepared.reason, detail: prepared.detail });
      log(`collect-captures: skipped ${prepared.name} (${prepared.id}) — ${prepared.reason}: ${prepared.detail}`);
      continue;
    }
    // Files the READ side dropped — a cap, an unreadable entry, a truncated one.
    // Carried into the summary rather than only logged, because a cap that drops
    // data and still exits 0 is silent truncation with extra steps (invariant F).
    for (const d of prepared.droppedFiles) droppedFiles.push({ id: prepared.id, ...d });
    if (prepared.missing.length > 0) {
      partial.push({ id: prepared.id, missing: prepared.missing });
      log(`collect-captures: artifact ${prepared.id} (PR #${prepared.meta.pr}) is missing ${prepared.missing.join(", ")} — meta.json lists ${prepared.meta.lenses.length} lens(es), ${prepared.lensCount} arrived.`);
    }
    let wrote = 0;
    for (const f of prepared.files) {
      // PER-FILE ISOLATION ON THE WRITE, and not only on the read. A `putCapture`
      // throw is a full disk, a read-only checkout or a key this store refuses —
      // none of which is a reason to abandon the artifacts that come after it.
      // Left unguarded, one ENOSPC on the first of ten captures discards the
      // other eight, which is the opposite of the fail direction this file holds:
      // the artifacts have a deadline and the disk does not.
      let outcome;
      try {
        outcome = dryRun ? (store.hasCapture(f.key) ? "present" : "written") : store.putCapture(f.key, f.bytes);
      } catch (e) {
        droppedFiles.push({ id: prepared.id, name: f.key, reason: "write-failed", detail: e.message });
        log(`collect-captures: artifact ${prepared.id} — could NOT write ${f.key}: ${e.message}`);
        continue;
      }
      if (outcome === "present") { present++; continue; }
      wrote++;
      bytes += f.bytes.length;
      log(`collect-captures: ${dryRun ? "would write" : "wrote"} ${f.key} (${f.bytes.length} bytes)`);
    }
    files += wrote;
    if (wrote > 0) collected++;
  }

  const summary = summarize({
    collected, files, bytes, present, skipped, partial, droppedFiles, dryRun,
    scanned: plan.fetch.length + plan.skipped.length,
    dropped: plan.dropped,
    walkFailed: walk.failed,
    walkTruncated: walk.truncated,
  });
  return { summary, plan, skipped, partial, droppedFiles, walk };
}

// --- CLI --------------------------------------------------------------------------

const USAGE = `Usage:
  collect-captures.mjs [collect] --root <dir> [--since <ISO date>] [--days <n>] [--write] [--limit <n>] [--repo <owner/name>]
  collect-captures.mjs expiry    --root <dir> [--since <ISO date>] [--days <n>] [--warn-days <n>] [--repo <owner/name>]

  collect   copy stage-detail artifacts into the store. PRINT-ONLY unless --write.
  expiry    read-only: how many captures are uncollected and how soon they die.

  --root    REQUIRED, and has no default. The store lives in the eval repo, not in
            this one — see capture-store.mjs. A forgotten default would commit
            capture data into whichever repository the code sits in, permanently.
  --repo    defaults to the repository \`gh\` resolves from the working directory.

Exit codes: 0 nothing wrong · 1 something was skipped that should not have been · 2 usage.`;

function sinceFrom(args, now) {
  if (args.since !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.since))) return { error: "--since takes an ISO date (YYYY-MM-DD)" };
    return { since: new Date(`${args.since}T00:00:00Z`) };
  }
  const days = args.days === undefined ? DEFAULT_SINCE_DAYS : Number(args.days);
  if (!Number.isInteger(days) || days <= 0) return { error: "--days takes a positive integer" };
  return { since: new Date(now.getTime() - days * 86400000) };
}

/**
 * A positive-integer flag, or a usage error naming it.
 *
 * `--warn-days` used to go through a bare `Number()`, and the failure was silent
 * in the worst available direction: `--warn-days abc` is `NaN`, every
 * `daysLeft <= NaN` is false, so NOTHING is ever urgent, the job exits 0 and
 * prints "0 within NaN day(s)". A typo in the threshold would have turned the
 * expiry warning off and reported success. Same rule as `--days` and `--limit`,
 * applied before anything else happens.
 */
function positiveInt(args, flag, fallback) {
  if (args[flag] === undefined) return { value: fallback };
  const n = Number(args[flag]);
  if (!Number.isInteger(n) || n <= 0) return { error: `--${flag} takes a positive integer` };
  return { value: n };
}

function main(argv, now = new Date()) {
  const args = parseArgs(argv, { booleans: ["write", "help"] });
  if (args.help) { console.log(USAGE); return 0; }
  const cmd = args._[0] ?? "collect";
  if (cmd !== "collect" && cmd !== "expiry") { console.error(`collect-captures: unknown command ${JSON.stringify(cmd)}\n${USAGE}`); return 2; }

  const { since, error } = sinceFrom(args, now);
  if (error) { console.error(`collect-captures: ${error}`); return 2; }

  // Every numeric flag validated up front, before the store is opened or a
  // single request is made, so a typo costs nothing and names itself.
  const warnDays = positiveInt(args, "warn-days", DEFAULT_WARN_DAYS);
  if (warnDays.error) { console.error(`collect-captures: ${warnDays.error}`); return 2; }
  const limit = positiveInt(args, "limit", MAX_ARTIFACTS);
  if (limit.error) { console.error(`collect-captures: ${limit.error}`); return 2; }

  // A USAGE error (2), not an operational one, and checked BEFORE any network
  // call so a missing flag costs nothing. `capture-store.mjs` refuses too — this
  // is the same refusal said in the CLI's vocabulary, because "capture store: a
  // root directory is required" as a stack trace is a worse first experience
  // than a usage line.
  if (args.root === undefined || String(args.root).trim() === "") {
    console.error(`collect-captures: --root is required and has no default.\n${USAGE}`);
    return 2;
  }

  const store = createCaptureStore(args.root);
  const io = ghArtifactIo({ repo: args.repo ?? null });
  try {
    if (cmd === "expiry") {
      const walk = walkArtifacts({ fetchPage: (p, n) => io.listPage(p, n), since, log: (m) => console.error(m) });
      const known = store.listCaptures();
      // Both inputs to the count, said out loud, because the count is only a
      // TOTAL if the walk reached the end of the list — and "0 uncollected"
      // read off a walk that stopped after two pages is the most misleading
      // output this job could produce.
      console.log(`capture-expiry: walked ${walk.pages} artifact page(s), ${walk.artifacts.length} artifact(s)${walk.stoppedEarly ? ", stopped early at the window edge" : ""} · ${known.length} file(s) already in the store`);
      const report = expiryReport(walk.artifacts, runIdsFromKeys(known), { now, warnWithinDays: warnDays.value });
      // stdout, not stderr: this IS the job's output, and a scheduled run's
      // summary should be readable without opening the log's error stream.
      for (const line of report.lines) console.log(line);
      if (walk.failed || walk.truncated) { console.error(`collect-captures: the artifact walk was incomplete (${walk.failed ?? "page cap"}), so this count is a LOWER BOUND.`); return 1; }
      return report.exitCode;
    }

    const { summary } = collect({ io, store, since, now, dryRun: !args.write, maxArtifacts: limit.value });
    console.log(summary.line);
    if (!args.write) console.log(`collect-captures: PRINT-ONLY — pass --write to copy these into ${args.root}.`);
    return summary.exitCode;
  } finally {
    io.cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
