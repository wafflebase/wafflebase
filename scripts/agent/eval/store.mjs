// Where a FROZEN CORPUS ITEM and one REPLAY of it land — and the one surface the
// eval data root is reached through, whether what you want is a corpus item, a
// replay's record of what the panel did, or a collected capture.
//
// TWO KINDS OF THING, WITH OPPOSITE MUTABILITY. A corpus item is a deterministic
// EXTRACTION: the same pull request re-extracted should produce the same bytes, so
// a second write is a determinism CHECK. A run item is an OBSERVATION of a
// non-deterministic judge: the same item replayed twice legitimately differs, so a
// second observation belongs under a new run id and overwriting one would delete a
// data point. Both are write-once, and the two refusals say different things
// because the right response to each is different — compare the first, re-run the
// second under a new id.
//
// WHAT A CORPUS ITEM IS, AND WHY ANYONE WOULD WANT ONE. Four files that between
// them are everything the review panel reads about one pull request:
// `diff.patch` (the reviewable change), `changed-files.txt` (the paths, so a
// lens's file-class scoping resolves the same way it did live), `issue-spec.md`
// (what the change was supposed to do, when a closing issue exists) and
// `meta.json` (which PR, at which commit, off which base, and the sha256 of the
// diff). Freeze those and a review becomes repeatable: the same bytes go in
// every time, so any difference in what comes out is a difference in the
// REVIEWER rather than in its input. That is what makes an item useful long
// before anything is being scored — `git diff` a frozen item against a lens's
// `appliesWhen` globs and you can see exactly which files that lens would have
// been shown.
//
// ONE STORE SURFACE OVER ONE ROOT. `capture-store.mjs` (#675) already owns
// collected captures and has a live consumer in the collector, so it is
// COMPOSED here rather than copied or widened: `store.captures` IS that module's
// three-method store, rooted at the same `captures/` subdirectory the collector
// writes to. Corpus items are this module's own. The alternative — a second
// class with its own root argument — is how two halves of one directory come to
// disagree about where they live.
//
// WHY THE CORPUS WRITE PATH IS NOT `putCapture`. A capture key and a corpus item
// look similar enough that delegating was tempting. Two reasons not to. First,
// `putCapture` treats an existing key as SUCCESS ("present"), which is right for
// a capture — the key names one execution of the panel, so the bytes cannot
// legitimately differ — and wrong for a corpus item, where a second extraction
// CAN produce different bytes (the diff moved, `gh` answered differently) and
// silently keeping the first copy is how a comparison ends up measuring two
// different inputs. Second, its refusals say "capture store:" and would be read
// by whoever is actually freezing a PR. Write-once is expressed here at the
// ITEM level instead, and `extract-corpus.mjs` turns a re-extraction into a
// determinism CHECK against the stored item rather than a no-op.
//
// FAIL DIRECTION. `hasCorpusItem` / `getCorpus` degrade: a root that does not
// exist yet is the ordinary first-run state, not a fault. `putCorpusItem` is the
// single write path and refuses on any doubt — including a `sha256_diff` that
// does not match the diff it travels with, because an item whose own hash is
// wrong is worse than no item: `labelStatus`'s drift check (PR 16) compares
// against that field, so a wrong one silently marks stale labels fresh.
// `getCorpusItemInput` splits the two failures deliberately, for a reason
// spelled out at the method.
//
// TRANSCRIPTS ARE NOT HERE, AND THAT IS THE ANSWER TO THE QUESTION. The fork's
// store gzipped each replay's full model transcript into itself
// (`eval/store.mjs:68` on `feat/agent-eval-harness`); spec §8 keeps transcripts
// out of git — they are 10–30 MB of debugging aid that no metric reads. So a
// transcript is routinely ABSENT, and the fail direction has to be decided
// rather than discovered:
//
//   1. There is no `getTranscript` on this surface. The absence is expressed by
//      there being no question to ask, which is the only version of "expected
//      absence" that cannot be misread. A method that answered `null` on every
//      call in production would be read, eventually, as "the model said
//      nothing" — this codebase has already shipped that exact confusion once
//      (missing panel output became "the panel found nothing", audit §4-E).
//   2. A run envelope refers to its transcript by a POINTER (a local path, later
//      an S3 key) carried in a NAMED state — `{state: "absent" | "local" |
//      "remote"}` — never `null`, never `""`. A falsy value is
//      indistinguishable from an empty transcript, and the difference between
//      "we did not keep it" and "there was nothing to keep" is exactly what a
//      person debugging a weird verdict needs to know. `TRANSCRIPT_STATES` is
//      that vocabulary and `validateRunEnvelope` refuses anything outside it, so
//      the rule is enforced at the write path rather than remembered.
//
// So: absence is normal, absence is never an error, and absence must never be
// spellable as a falsy value.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { createCaptureStore } from "../capture-store.mjs";
import { PANEL_DIGEST_MIXED, PANEL_DIGEST_SOURCES, PANEL_DIGEST_STATES, isPanelDigest } from "./panel-identity.mjs";

/**
 * The captures subdirectory, defined ONCE because two producers depend on it
 * agreeing: `.github/workflows/capture-collect.yml` passes
 * `--root .capture-store/captures` to the collector, and this store delegates
 * `store.captures` to the same place. Written as two independent literals they
 * drift, and the drift is silent in the worst direction — the collector keeps
 * filling one directory while every reader looks in another, and both sides
 * report success. `store.test.mjs` reads the real workflow file and pins the two
 * together.
 */
export const CAPTURES_SUBDIR = "captures";

/** Corpus layout, per spec §8: `corpus/items/<id>/…` + `corpus/manifests/<version>.json`. */
export const CORPUS_DIR = "corpus";

/** Run layout: `runs/<run id>/run.json` + `.../items/<item id>/…`. */
export const RUNS_DIR = "runs";

/**
 * Metrics layout, per the store README: `scores/per-run/<run id>/<scorer id>.json`
 * and `scores/by-config/<config hash>__<panel digest>__<corpus version>/<scorer
 * id>.json` — three parts since the panel got a content identity of its own, for the
 * reason `byConfigSegment` gives.
 *
 * 🔴 UNLIKE EVERY OTHER WRITE PATH IN THIS MODULE, SCORES ARE RE-WRITABLE, and
 * that is not an oversight — it is the reason the directory exists. The README's
 * invariant reads "Metrics live in `scores/`, never in `runs/` — change a
 * matcher/metric and re-score cached run artifacts (cheap); no need to re-invoke
 * the model." Re-scoreability IS the point: #780 moved every defect-class count in
 * this store without one model call, and a write-once `scores/` would have left
 * that re-score unfilable.
 *
 * So `putRun`'s refuse-on-conflict discipline is deliberately NOT copied here, and
 * its reasoning does not transfer either. `putRun` refuses a differing
 * `config_hash` because two reviewers' items must never be filed under one run id,
 * which is a statement about an OBSERVATION of a non-deterministic judge. A score
 * is a DERIVATION over observations that remain immutable underneath it — the runs
 * it was computed from cannot move — so recomputing from them is safe by
 * construction and the superseded value is evidence of nothing.
 *
 * The next reader will assume this store is uniformly write-once, because two of
 * its three write paths are. It is not, and this is the exception.
 */
export const SCORES_DIR = "scores";

/** Static A-vs-B comparisons: `reports/<comparison id>.md`. Re-writable for the
 *  same reason `scores/` is — a report renders scores and holds no observation of
 *  its own, so it is reproducible from the files it was built from. */
export const REPORTS_DIR = "reports";

/**
 * WHAT A SCORE IS ABOUT, and therefore which of the store's two score directories
 * it is filed under.
 *
 * The vocabulary is #791's (`scope: "cross-run"`), which chose it so that whichever
 * PR persisted a score would find a shape already agreed rather than inventing a
 * second one. The DIRECTORY names are the README's. They differ on purpose, and the
 * asymmetry is the whole content of this constant: `scope` says which population
 * the metric describes, while the directory says what the file is KEYED BY. A
 * cross-run metric is keyed by `(config_hash, corpus_version)` rather than by the
 * run ids it consumed, because that pair is the comparability key — it is what
 * makes those runs replicates of one another at all — and a directory named after
 * one of the run ids would file a K=3 figure under a third of its own input.
 */
export const SCORE_SCOPES = Object.freeze(["per-run", "cross-run"]);

/** Which subdirectory of `scores/` each scope is keyed under, written once so a
 *  reader, a writer and a test cannot disagree about where a score lives. */
export const SCORE_SCOPE_DIRS = Object.freeze({ "per-run": "per-run", "cross-run": "by-config" });

/**
 * A run directory's two files, and they have opposite mutability rules.
 *
 * `run.json` is a STATUS SUMMARY of an immutable item set, so it is rewritten as
 * the run progresses and recomputed from what is on disk. `config.snapshot.json`
 * is IDENTITY — it says which reviewer produced every item under this run id — so
 * it is written once and a second, different snapshot is refused rather than
 * ignored. See `putRun`.
 */
export const RUN_FILES = Object.freeze({
  run: "run.json",
  configSnapshot: "config.snapshot.json",
});

/**
 * One item's two files. `payload.json` holds what the target produced;
 * `envelope.json` is the record OF that production, and it is written LAST for
 * the same reason `meta.json` is last in a corpus item: `hasItem` keys on it, so
 * "the item exists" means "the item is complete".
 *
 * There is no `transcript.json.gz`. The fork's store gzipped each replay's full
 * model transcript into itself; spec §8 keeps transcripts out of git, so absence
 * is the NORMAL state and the envelope carries a named `transcript` state instead
 * — see `TRANSCRIPT_STATES`.
 */
export const ITEM_FILES = Object.freeze({
  envelope: "envelope.json",
  payload: "payload.json",
});

/**
 * TWO statuses, not three, and `ok` means exactly one thing: **this item is a
 * real verdict and may be pooled as one.**
 *
 * The version this replaces had `ok` / `error` / `skipped` and could reach `ok`
 * with zero findings for four different broken reasons — a panel that exited
 * non-zero, a panel that never wrote `panel.json`, a novelty gate that silently
 * did not run, a capture missing the routed diff. All four produced an envelope
 * saying the panel looked and found nothing, which is not noise: in a precision
 * metric a false clean review is a PERFECT SCORE. So there is one bit for
 * poolability and a separate `reason` string for which failure it was, and
 * anything short of a complete, attributable, un-degraded review is `error`.
 *
 * `skipped` is gone because nothing produces it: an item the runner never
 * attempted is simply absent, and absence is already unambiguous here.
 */
export const ITEM_STATUSES = Object.freeze(["ok", "error"]);

/**
 * How a run envelope may refer to its transcript, and the answer is never a
 * falsy value.
 *
 * PR 3 settled this for corpus items and the reasoning transfers unchanged: a
 * transcript is 10–30 MB of debugging aid no metric reads, spec §8 keeps it out of
 * git, so it is ROUTINELY absent. A `null` or `""` would be indistinguishable
 * from an empty transcript, and "we did not keep it" versus "there was nothing to
 * keep" is exactly what someone debugging a strange verdict needs to know. This
 * codebase has already shipped the falsy-means-two-things confusion once — a
 * missing panel output became "the panel found nothing" — and this PR is largely
 * the cleanup.
 */
export const TRANSCRIPT_STATES = Object.freeze(["absent", "local", "remote"]);

/**
 * The four files of an item, named once so a reader, a writer and a test cannot
 * disagree about what "a corpus item" means on disk.
 *
 * `issueSpec` is the only optional one: most PRs close no issue, and an empty
 * `issue-spec.md` would be indistinguishable from an issue whose body was blank.
 * `meta.has_issue_spec` carries the distinction.
 */
export const CORPUS_ITEM_FILES = Object.freeze({
  meta: "meta.json",
  diff: "diff.patch",
  changedFiles: "changed-files.txt",
  issueSpec: "issue-spec.md",
});

/**
 * An item id and a corpus version both become PATH SEGMENTS, so both are
 * validated against a narrow grammar rather than sanitised. Item ids are built
 * from a PR number today (`pr-664`) but arrive from `meta.json` on any read, and
 * a `--corpus-version` comes off a command line; neither may contain a
 * separator, a `..`, or a NUL. Same shape as `capture-store.mjs`'s key grammar,
 * minus the `=` that only its Athena-style partitions need.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA40 = /^[0-9a-f]{40}$/;
/** The `sha256:<hex>` form every content hash in the benchmark uses. */
const SHA256_TEXT = /^sha256:[0-9a-f]{64}$/;
/** Same marker `capture-store.mjs` uses, for the same reason — see `writeFileAtomic`. */
const PART_MARK = ".part-";

const refuse = (msg) => {
  throw new Error(`eval store: ${msg}`);
};

/**
 * Content hash of any text, as `sha256:<hex>`.
 *
 * Lives here rather than in `config-hash.mjs` (which is PR 4's module, and which
 * the audit found broken in three ways) so that freezing a PR does not depend on
 * config identity landing first. PR 4 should import this one rather than define a
 * second: two hash helpers with the same output format is how `sha256_diff` and
 * a label's `diff_sha256` come to be computed differently and compare unequal
 * forever.
 */
export function contentSha256(text) {
  return `sha256:${createHash("sha256").update(String(text ?? ""), "utf8").digest("hex")}`;
}

/**
 * THERE IS NO DEFAULT ROOT. The full reasoning is in `capture-store.mjs` and it
 * applies unchanged: git history is permanent, so a forgotten `--root` that fell
 * back to a path inside THIS repository would commit benchmark data into
 * `wafflebase` for good, and no later `git rm` shrinks anyone's clone. The data
 * lives in `dlgpdmsly2/wafflebase-agent-eval` and will live in a bucket later;
 * both are the caller's business and neither is this module's to guess.
 */
function requireRoot(root) {
  if (typeof root !== "string" || root.trim() === "") {
    refuse(
      "a root directory is required — there is no default, because a forgotten one would " +
        "commit corpus data into whichever repository the code happens to live in, permanently.",
    );
  }
  return path.resolve(root);
}

function requireSegment(what, value) {
  if (typeof value !== "string" || !SEGMENT.test(value)) {
    refuse(`${what} must match ${SEGMENT.source}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Write `bytes` to `abs` through a temp file and a rename, so the destination is
 * only ever absent or COMPLETE.
 *
 * Copied in spirit from `capture-store.mjs`'s `putCapture` and for its reason: a
 * crash or an ENOSPC part-way through a direct write leaves a TRUNCATED file at
 * the real path, and a truncated `diff.patch` is a corpus item that replays
 * cleanly against the wrong input. It is copied rather than shared because
 * exporting a helper out of `capture-store.mjs` means editing a merged module
 * with a live consumer to serve a caller it does not have.
 *
 * Unlike `putCapture` this OVERWRITES. Item-level write-once (below) is what
 * makes a corpus item immutable; a file left behind by a write that died before
 * `meta.json` landed is debris from an incomplete item, and refusing to replace
 * it would make that item unwritable forever.
 */
function writeFileAtomic(abs, bytes) {
  mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}${PART_MARK}${process.pid}`;
  rmSync(tmp, { force: true }); // debris from an earlier run whose pid the OS recycled
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, abs);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * A `config_hash` as a PATH SEGMENT: `sha256:<hex>` becomes `sha256-<hex>`.
 *
 * THIS IS NOT THE FORK'S MANGLE, and the difference is the validation that comes
 * first. `_runDir` below condemns the fork's store for running every id through a
 * `[:/\\] → -` replace, "which silently maps two distinct run ids onto one
 * directory" — the failure there is that the replace ran over an UNCONSTRAINED
 * string, where `a:b` and `a-b` are two ids that collide into one path. Here the
 * input is refused unless it matches `SHA256_TEXT` first, so the domain is exactly
 * `sha256:` followed by 64 lowercase hex characters, and over that fixed-width
 * domain the map is INJECTIVE: the only colon is the one at index 6, and no hash
 * can spell a `-` there. Two distinct config hashes cannot land in one directory.
 *
 * The alternative was to leave the colon in. It is legal on POSIX and would make
 * the directory name the hash verbatim, which reads better — but a store that has
 * to be checked out on Windows or copied through a bucket key would break, and the
 * `__smoke` artifact already on disk from the fork era is named `sha256-…`, so
 * this keeps one convention rather than adding a second beside it.
 *
 * The derived segment is passed back through `requireSegment` by its callers
 * anyway. That is redundant today by the argument above, and it is the check that
 * keeps the argument true if `SHA256_TEXT` is ever widened.
 */
export function configHashSegment(configHash) {
  if (!SHA256_TEXT.test(String(configHash ?? ""))) {
    refuse(
      `config hash must be sha256:<64 hex> to become a path segment, got ${JSON.stringify(configHash)} — ` +
        "it is validated rather than sanitised, because sanitising an unconstrained id is how two of them come to share one directory",
    );
  }
  return configHash.replace(":", "-");
}

/**
 * A `panel_digest` as a PATH SEGMENT — the SEAM the panel-equivalence mechanism
 * replaces, and the only function it has to replace.
 *
 * Today it is the identity map onto `configHashSegment`'s mangle for a real digest,
 * and a pass-through for the two named states. What is designed to land here next is
 * a human declaration that two panel versions are EQUIVALENT — that #797's
 * `console.log` → `console.error` did not make a new reviewer — which means mapping
 * several digests onto one class id. Routing the middle segment through one function
 * is what keeps that a change to THIS function rather than a second sweep through
 * `byConfigSegment`'s call sites in `report.mjs` and `score-all.mjs`.
 *
 * 🔴 IT IS NOT PERMISSIVE. There is no default and no fallback: a caller with nothing
 * to say about the panel must say `not-recorded` explicitly, which is a directory a
 * reader can see, rather than getting the legacy two-part path by omission. A default
 * here would leave the collision this segment exists to remove in place for every
 * caller that had not been updated, which is the whole defect.
 *
 * The two named states pass through UNMANGLED because they contain no colon and are
 * already legal segments; they cannot collide with a real digest, which always begins
 * `sha256-`. `requireSegment` at the join is what keeps that true.
 */
export function panelKeySegment(panelDigest) {
  const value = String(panelDigest ?? "");
  if (PANEL_DIGEST_STATES.includes(value)) return value;
  if (!SHA256_TEXT.test(value)) {
    refuse(
      `panel digest must be sha256:<64 hex> or one of ${PANEL_DIGEST_STATES.join(" | ")} to become a path segment, got ${JSON.stringify(panelDigest)} — ` +
        "it is refused at the same door config_hash is, and for the same reason: an unconstrained id that is sanitised rather than validated is how two of them come to share one directory",
    );
  }
  return value.replace(":", "-");
}

/**
 * The `by-config` directory name for one comparability key.
 *
 * 🔴 THREE PARTS, NOT TWO, AND THE MIDDLE ONE IS THE FIX. The key used to be
 * `(config_hash, corpus_version)`, and `config-hash.mjs` says in its own header that
 * it "hashes the LENS COMPOSITION, not the panel's code" — so two runs of two
 * different panels produced one directory name, and the second cross-run score
 * overwrote the first. Measured on the live data: one ingested run pools 16 items
 * across 5 panels by content, all under one `config_hash`. The reviewer is the pair,
 * so the KEY is the pair, and `panel_digest` is the half that was missing.
 *
 * Joined with `__` because the fork-era artifact on disk already is
 * (`sha256-7470…__smoke`). Every part is validated before it is joined and the JOIN is
 * validated after, so neither a `corpus_version` nor a digest carrying a separator can
 * smuggle a second directory level in behind a valid-looking hash.
 *
 * ⚠ A TWO-PART DIRECTORY IS NEITHER READ NOR DELETED. Nothing here matches one: the
 * old `sha256-<hash>__<corpus>` names cannot be produced by this function any more, so
 * scores filed before the panel had an identity stay exactly where they are and are
 * simply not found. That is deliberate — silently matching them would pool the panels
 * this key exists to separate, which is the defect with an extra step.
 */
export function byConfigSegment(configHash, panelDigest, corpusVersion) {
  const hash = configHashSegment(configHash);
  const panel = panelKeySegment(panelDigest);
  const version = requireSegment("corpus version", corpusVersion);
  return requireSegment("by-config segment", `${hash}__${panel}__${version}`);
}

/**
 * Everything that must be true of a score before it may be written.
 *
 * WIDENS, NEVER NARROWS, and here that rule is doing real work rather than being
 * recited: of the four scorers this store will hold, only `cost-latency-v1` (#791)
 * carries `scorer_id` and `scope` in its own payload — `volume-mix.mjs`,
 * `complementarity.mjs` and `reliability.mjs` carry neither, because all three were
 * written to print rather than to be filed. So both fields are OPTIONAL in the
 * payload and REQUIRED at the call, and back-filling them into three merged
 * scorers is not this module's business.
 *
 * What it does check is that the two do not DISAGREE. A payload that names itself
 * `reliability-v1` filed under `volume-mix-v1` means one of the two is wrong and
 * there is no way to tell which — the same rule, for the same reason, as `meta.id`
 * and `envelope.run_id`.
 */
export function validateScore(scorerId, scope, score) {
  requireSegment("scorer id", scorerId);
  if (!SCORE_SCOPES.includes(scope)) {
    refuse(`score ${scorerId}: scope must be one of ${SCORE_SCOPES.join(" | ")}, got ${JSON.stringify(scope)}`);
  }
  if (score === null || typeof score !== "object" || Array.isArray(score)) {
    refuse(`score ${scorerId} must be a JSON object, got ${JSON.stringify(score)}`);
  }
  if (score.scorer_id !== undefined && score.scorer_id !== scorerId) {
    refuse(
      `score payload names itself ${JSON.stringify(score.scorer_id)} but is being filed under ${JSON.stringify(scorerId)} — ` +
        "one of the two is wrong and nothing downstream can tell which",
    );
  }
  if (score.scope !== undefined && score.scope !== scope) {
    refuse(
      `score ${scorerId} payload declares scope ${JSON.stringify(score.scope)} but is being filed as ${JSON.stringify(scope)} — ` +
        "the scope decides which directory it lands in, so a disagreement files a cross-run figure under one of its own runs",
    );
  }
  return score;
}

/**
 * A cross-run score must NAME THE PANEL its path files it under, in its own payload.
 *
 * The path and the payload are two records of one fact, and this is the rule that
 * keeps them from disagreeing — the same rule, for the same reason, as `scorer_id` and
 * `scope` in `validateScore` above, and as `meta.id` against `envelope.run_id`. A
 * payload naming a panel other than the one it is filed under means one of the two is
 * wrong and nothing downstream can tell which.
 *
 * 🔴 A `mixed` SCORE MUST CARRY THE MIXTURE. The mixed-panel opt-out exists so the
 * live agent-PR run — 16 items, 5 panels — can be scored at all, and the whole point
 * of making it say so is that the saying survives into the file. So `mixed` in the
 * path additionally requires `panel_digests`, a list of at least two, and a payload
 * that claims `mixed` while naming one panel is refused: an averaged number that reads
 * as a single reviewer's is worse than no number, because nothing downstream would
 * ever ask again.
 */
export function validateScorePanel(scorerId, panelDigest, score) {
  const stated = score?.panel_digest;
  if (stated !== panelDigest) {
    refuse(
      `score ${scorerId} is being filed under panel ${JSON.stringify(panelDigest)} but its payload says ${JSON.stringify(stated)} — ` +
        "a cross-run number must name its own panel, because the path is not readable from the file and one of the two is wrong",
    );
  }
  // AND WHERE THE DIGEST CAME FROM, from the closed vocabulary. A score filed under a
  // digest that was computed out of git after the fact and one filed under a digest hashed
  // while the panel ran are different claims about how well the number is attributed, and
  // the path cannot tell them apart. Checked here so the field cannot be decorative: a
  // typo'd source would otherwise sit in the payload meaning nothing.
  if (!PANEL_DIGEST_SOURCES.includes(score?.panel_digest_source)) {
    refuse(
      `score ${scorerId} states panel_digest_source ${JSON.stringify(score?.panel_digest_source)}, which is not one of ` +
        `${PANEL_DIGEST_SOURCES.join(" | ")} — "hashed while the panel ran" and "reconstructed from git afterwards" are ` +
        "different claims about the same number, and nothing downstream can recover which was meant",
    );
  }
  if (panelDigest !== PANEL_DIGEST_MIXED) return score;
  const list = score?.panel_digests;
  if (!Array.isArray(list) || new Set(list).size < 2 || !list.every((d) => isPanelDigest(d) || PANEL_DIGEST_STATES.includes(d))) {
    refuse(
      `score ${scorerId} is filed as ${JSON.stringify(PANEL_DIGEST_MIXED)} but panel_digests is ${JSON.stringify(list)} — ` +
        "a mixed score must list the panels it pooled, at least two of them, or nothing downstream can tell what was averaged",
    );
  }
  return score;
}

/**
 * Everything that must be true of an item before it may be written, checked in
 * one exported place so a hand-written item can be validated by the same rules
 * the extractor's output is.
 *
 * WIDENS, NEVER NARROWS. Unknown fields in `meta` are not rejected and not
 * dropped — `meta.json` is stored as given, so a field PR 7 or PR 16 adds
 * survives a store that has never heard of it. This is the convention that the
 * finding adapters broke twice (decision 7); a validator is allowed to demand
 * fields, never to decide the full list.
 *
 * Returns the normalised `{meta, diff, changedFiles, issueSpec}` to write.
 */
export function validateCorpusItem(itemId, { meta, diff, changedFiles, issueSpec } = {}) {
  requireSegment("item id", itemId);
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    refuse(`meta for ${itemId} must be a JSON object, got ${JSON.stringify(meta)}`);
  }
  // A `meta.id` that disagrees with the directory it is filed under means one of
  // the two is wrong and there is no way to tell which. Everything downstream
  // joins on the id.
  if (meta.id !== itemId) {
    refuse(`meta.id ${JSON.stringify(meta.id)} does not match the item id ${JSON.stringify(itemId)}`);
  }
  if (typeof diff !== "string" || diff.trim() === "") {
    refuse(`${itemId} has an empty diff — an item with nothing to review is an extraction failure, not an item`);
  }

  // `review_commit` is what a replay checks the repo out at. Without it the
  // replay reviews whatever HEAD happens to be.
  if (!SHA40.test(String(meta.review_commit ?? ""))) {
    refuse(
      `${itemId}: meta.review_commit must be 40 lowercase hex characters, got ${JSON.stringify(meta.review_commit)} — ` +
        `it is the commit a replay checks the tree out at`,
    );
  }
  // The message names PR 6 on purpose. `review_base` is not decoration: it is
  // what lets a replay pass `--base-sha`, which is what switches the shipped
  // novelty gate ON. Without it every replay measures the gate with novelty OFF
  // and `lane: "backlog"` can never occur — a replayed gate that is not the
  // shipped gate, with nothing in the output saying so.
  if (!SHA40.test(String(meta.review_base ?? ""))) {
    refuse(
      `${itemId}: meta.review_base must be 40 lowercase hex characters, got ${JSON.stringify(meta.review_base)} — ` +
        `PR 6 needs it to pass --base-sha, and without it a replay silently measures the novelty gate OFF`,
    );
  }
  // Which review point the diff was taken at, and how the diff was produced.
  // Both are provenance a scorer may need to exclude items on; the vocabulary of
  // each belongs to `extract-corpus.mjs`, so only presence is checked here.
  for (const field of ["review_point", "diff_method"]) {
    if (typeof meta[field] !== "string" || meta[field].trim() === "") {
      refuse(`${itemId}: meta.${field} must be a non-empty string, got ${JSON.stringify(meta[field])}`);
    }
  }

  // The hash is RECOMPUTED, not merely shape-checked. A `sha256_diff` that does
  // not describe the diff stored beside it is the failure this whole module is
  // most exposed to: it looks fine, it survives every read, and PR 16's
  // staleness check compares against it.
  if (!SHA256_TEXT.test(String(meta.sha256_diff ?? ""))) {
    refuse(`${itemId}: meta.sha256_diff must be sha256:<64 hex>, got ${JSON.stringify(meta.sha256_diff)}`);
  }
  const actual = contentSha256(diff);
  if (meta.sha256_diff !== actual) {
    refuse(`${itemId}: meta.sha256_diff ${meta.sha256_diff} does not match the diff it travels with (${actual})`);
  }

  const metaFiles = Array.isArray(meta.changed_files) ? meta.changed_files : null;
  if (!metaFiles || metaFiles.length === 0) {
    refuse(`${itemId}: meta.changed_files must be a non-empty array — a diff always touches at least one path`);
  }
  for (const f of metaFiles) {
    // `changed-files.txt` is line-based and its reader trims each line, so a path
    // with surrounding whitespace could not round-trip: the two copies would then
    // disagree for the consumers below. Reject it at the write path.
    if (typeof f !== "string" || f !== f.trim() || f === "") {
      refuse(`${itemId}: meta.changed_files contains ${JSON.stringify(f)}`);
    }
  }
  // `changedFiles` is accepted as its own argument because the surface reads
  // better that way, but the two copies may not disagree: `changed-files.txt`
  // and `meta.changed_files` are read by different consumers, and a lens scoped
  // off one while a scorer segments off the other is a bias with no symptom.
  const files = changedFiles === undefined || changedFiles === null ? metaFiles : changedFiles;
  if (!Array.isArray(files) || files.length !== metaFiles.length || files.some((f, i) => f !== metaFiles[i])) {
    refuse(`${itemId}: changedFiles disagrees with meta.changed_files — they are read by different consumers and must be one list`);
  }

  const spec = issueSpec === undefined || issueSpec === null ? "" : String(issueSpec);
  if (!!meta.has_issue_spec !== (spec.trim() !== "")) {
    refuse(`${itemId}: meta.has_issue_spec is ${JSON.stringify(meta.has_issue_spec)} but the issue spec is ${spec.trim() === "" ? "empty" : "present"}`);
  }

  return { meta, diff, changedFiles: [...files], issueSpec: spec };
}

/**
 * The item's four files as bytes, in the order they must be WRITTEN.
 *
 * Exported for one specific reason: the ORDER is a decision (see the `meta.json`
 * comment below) and it is otherwise unobservable. It only has an effect when a
 * write is interrupted part-way, so nothing about a completed item reveals it,
 * and a test that cannot see it is a decision that can be silently reversed.
 * `store.test.mjs` asserts the order here and then replays the interrupted-write
 * state it produces.
 */
export function itemFileBytes({ meta, diff, changedFiles, issueSpec }) {
  const files = [
    [CORPUS_ITEM_FILES.diff, diff],
    // One path per line, no trailing blank line. `changedFiles` is never empty
    // (the validator refuses that), so there is no "one empty line" case.
    [CORPUS_ITEM_FILES.changedFiles, changedFiles.join("\n") + "\n"],
  ];
  if (issueSpec.trim() !== "") files.push([CORPUS_ITEM_FILES.issueSpec, issueSpec]);
  // `meta.json` LAST. Its presence is what `hasCorpusItem` reads, so writing it
  // last makes "the item exists" mean "the item is complete" — the same ordering
  // rule, for the same reason, as the collector's (`collect-captures.mjs`: a
  // capture with attribution and no measurement reads downstream as a review
  // that found nothing). A crash before this line leaves an item that is absent,
  // which is recoverable; the other order leaves one that is wrong.
  files.push([CORPUS_ITEM_FILES.meta, JSON.stringify(meta, null, 2) + "\n"]);
  return files;
}

/**
 * Everything that must be true of a run envelope before it may be written.
 *
 * WIDENS, NEVER NARROWS — unknown fields are neither rejected nor dropped, so a
 * field PR 13 or PR 19 adds survives a store that has never heard of it. What it
 * demands is the handful of fields whose ABSENCE would be silent and unrecoverable:
 *
 *   `panel_sha`  the pair `(config_hash, panel_sha)` is what "same reviewer"
 *                means. `config_hash` identifies the lens composition and cannot
 *                see the panel's code, so a new verifier stage or a changed gate
 *                leaves it identical. Without `panel_sha` a replay envelope and a
 *                live capture cannot be pooled on the same key at all, and the
 *                trap is specific rather than theoretical: the runner resolves the
 *                panel as its own sibling, so running from a feature branch
 *                measures THAT branch's panel. Recording which commit ran is the
 *                only thing that makes the difference visible.
 *   `panel_digest` the same question answered by CONTENT, and it is a different
 *                answer: the 16 ingested agent items carry 16 distinct `panel_sha`
 *                values and are 5 panels by content, so a commit-keyed identity
 *                refuses to pool runs that cannot differ (#830 deleted the panel and
 *                #850 returned it byte-identical). This is the half the cross-run
 *                score PATH is keyed by, so an envelope without it cannot be scored
 *                against anything. RECORDED, never recomputed — see
 *                `panel-identity.mjs`, which is also why a scorer may not derive it.
 *   `gate`       whether the novelty gate ran. A run with the gate and a run
 *                without it produce identical-looking output, and pooling the two
 *                is the measurement error this lane exists to prevent.
 *   `transcript` a NAMED state — see `TRANSCRIPT_STATES`.
 *   `reason`     present exactly when the status is `error`. A bare `error` with
 *                no reason is a failure nobody can act on; an `ok` carrying one is
 *                two disagreeing claims about the same item.
 *
 * The reason VOCABULARY is deliberately not checked here. The store is
 * target-agnostic — it holds envelopes for whatever arms the benchmark grows — and
 * the closed list of ways a review panel can fail belongs to the module that
 * produces them (`run.mjs`'s `ITEM_REASONS`), which asserts it against itself.
 */
export function validateRunEnvelope(runId, itemId, envelope) {
  requireSegment("run id", runId);
  requireSegment("item id", itemId);
  const e = envelope;
  if (e === null || typeof e !== "object" || Array.isArray(e)) {
    refuse(`envelope for ${runId}/${itemId} must be a JSON object, got ${JSON.stringify(e)}`);
  }
  // Same rule and reason as `meta.id`: everything downstream joins on these, and a
  // record filed under one id while claiming another leaves no way to tell which
  // of the two is wrong.
  if (e.run_id !== runId) refuse(`envelope.run_id ${JSON.stringify(e.run_id)} does not match the run id ${JSON.stringify(runId)}`);
  if (e.item_id !== itemId) refuse(`envelope.item_id ${JSON.stringify(e.item_id)} does not match the item id ${JSON.stringify(itemId)}`);

  if (!ITEM_STATUSES.includes(e.status)) {
    refuse(`${runId}/${itemId}: envelope.status must be one of ${ITEM_STATUSES.join(" | ")}, got ${JSON.stringify(e.status)}`);
  }
  const hasReason = typeof e.reason === "string" && e.reason.trim() !== "";
  if (e.status === "ok" && hasReason) {
    refuse(`${runId}/${itemId}: status is "ok" but a reason (${JSON.stringify(e.reason)}) is set — an item cannot both be a real verdict and have failed`);
  }
  if (e.status === "error" && !hasReason) {
    refuse(`${runId}/${itemId}: status is "error" with no reason — a failure nobody can name is a failure nobody can exclude`);
  }
  if (e.status === "error" && !(e.error && typeof e.error.message === "string" && e.error.message.trim() !== "")) {
    refuse(`${runId}/${itemId}: status is "error" but envelope.error carries no message`);
  }

  if (!SHA40.test(String(e.panel_sha ?? ""))) {
    refuse(
      `${runId}/${itemId}: envelope.panel_sha must be 40 lowercase hex characters, got ${JSON.stringify(e.panel_sha)} — ` +
        "the reviewer is the PAIR (config_hash, panel_sha), and without the second half a replay cannot be pooled with a live capture",
    );
  }
  if (!isPanelDigest(e.panel_digest)) {
    refuse(
      `${runId}/${itemId}: envelope.panel_digest must be sha256:<64 hex>, got ${JSON.stringify(e.panel_digest)} — ` +
        "panel_sha says which COMMIT ran and this says which PANEL, and they are not the same question: 16 of the ingested " +
        "items carry 16 distinct panel_sha values and are 5 panels by content. The digest is what a cross-run score is keyed by",
    );
  }
  for (const field of ["config_hash", "corpus_version"]) {
    if (typeof e[field] !== "string" || e[field].trim() === "") {
      refuse(`${runId}/${itemId}: envelope.${field} must be a non-empty string, got ${JSON.stringify(e[field])}`);
    }
  }
  if (!(e.gate && typeof e.gate.state === "string" && e.gate.state.trim() !== "")) {
    refuse(
      `${runId}/${itemId}: envelope.gate.state must be a non-empty string, got ${JSON.stringify(e.gate)} — ` +
        "a scorer that cannot tell a run that had the novelty gate from one that did not will pool them",
    );
  }
  if (!(e.transcript && TRANSCRIPT_STATES.includes(e.transcript.state))) {
    refuse(
      `${runId}/${itemId}: envelope.transcript.state must be one of ${TRANSCRIPT_STATES.join(" | ")}, got ${JSON.stringify(e.transcript)} — ` +
        'never null and never "", because "we did not keep it" and "there was nothing to keep" are different facts',
    );
  }
  // `null` is a legitimate duration: it means the panel wrote no
  // `review-timing.json`, and the alternative — substituting `sumExecutions`'s flat
  // sum — records a number that is 3–5× high because the panel's lenses, samples
  // and verifier calls all run concurrently. So the absence is storable, and
  // `duration_source` is what a latency metric reads to decide whether to count it.
  if (!(e.duration_ms === null || (Number.isFinite(e.duration_ms) && e.duration_ms >= 0))) {
    refuse(`${runId}/${itemId}: envelope.duration_ms must be null or a non-negative number, got ${JSON.stringify(e.duration_ms)}`);
  }
  if (typeof e.duration_source !== "string" || e.duration_source.trim() === "") {
    refuse(`${runId}/${itemId}: envelope.duration_source must say where duration_ms came from, got ${JSON.stringify(e.duration_source)}`);
  }
  return e;
}

/** Stable JSON for comparing two config snapshots. Key ORDER is not identity —
 *  `config_hash` is — so the comparison sorts keys before it decides two snapshots
 *  disagree, and reports a difference only when a value really moved. */
function canonicalJson(value) {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v,
  );
}

export class EvalStore {
  constructor(root) {
    this.root = requireRoot(root);
    /**
     * The merged capture store, over the same root's `captures/`. Delegated and
     * not reimplemented: it is tested, it has a live consumer in the collector,
     * and its three-method surface is deliberately narrow. Reading a capture
     * back is not on that surface (it has no `getCapture`) and this PR does not
     * add one — the first consumer of a capture READ is the panel adapter in
     * PR 5, and a method written before its consumer is an untested surface.
     */
    this.captures = createCaptureStore(path.join(this.root, CAPTURES_SUBDIR));
  }

  _itemDir(itemId) {
    return path.join(this.root, CORPUS_DIR, "items", requireSegment("item id", itemId));
  }

  _manifestPath(version) {
    return path.join(this.root, CORPUS_DIR, "manifests", `${requireSegment("corpus version", version)}.json`);
  }

  /** Is this item frozen AND complete? Keyed on `meta.json` — see `itemFileBytes`. */
  hasCorpusItem(itemId) {
    return existsSync(path.join(this._itemDir(itemId), CORPUS_ITEM_FILES.meta));
  }

  /**
   * Freeze one item. WRITE-ONCE at the item level: an existing item throws
   * rather than being overwritten.
   *
   * Throwing rather than answering "present" (as `putCapture` does) is the whole
   * reason this method is not a delegation. A second extraction of the same PR
   * SHOULD normally produce identical bytes — that is the determinism the replay
   * premise rests on — but it is not guaranteed to, and the case where it does
   * not is precisely the one that must not pass quietly. So the refusal is the
   * store's, and `extract-corpus.mjs` calls `hasCorpusItem` first and compares
   * the stored item against the fresh extraction, reporting drift loudly instead
   * of overwriting or skipping in silence.
   */
  putCorpusItem(itemId, item) {
    const normalised = validateCorpusItem(itemId, item);
    if (this.hasCorpusItem(itemId)) {
      refuse(`corpus item ${itemId} already exists (corpus items are write-once); compare it instead of overwriting it`);
    }
    const dir = this._itemDir(itemId);
    for (const [name, bytes] of itemFileBytes(normalised)) {
      writeFileAtomic(path.join(dir, name), bytes);
    }
    return "written";
  }

  /**
   * One item's frozen inputs, or `null` if it was never frozen.
   *
   * THE TWO FAILURES ARE SPLIT ON PURPOSE, and this is the one place in the
   * module where a read throws. An ABSENT item is an ordinary state — not
   * extracted yet — and answers `null`. An item that is PRESENT but unreadable
   * (unparseable `meta.json`, a missing `diff.patch`) throws, because the
   * alternative silently shrinks the corpus: a runner that skips it produces a
   * comparison over fewer items than it reports, and every proportion in the
   * final report carries an `n` that is then wrong. Nothing this module writes
   * can produce that state, so reaching it means a hand edit or an interrupted
   * write, and both are worth a stack trace.
   */
  getCorpusItemInput(itemId) {
    const dir = this._itemDir(itemId);
    const metaPath = path.join(dir, CORPUS_ITEM_FILES.meta);
    if (!existsSync(metaPath)) return null;
    let meta;
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch (e) {
      refuse(`corpus item ${itemId} has an unreadable ${CORPUS_ITEM_FILES.meta}: ${e.message}`);
    }
    const diffPath = path.join(dir, CORPUS_ITEM_FILES.diff);
    if (!existsSync(diffPath)) {
      refuse(`corpus item ${itemId} has ${CORPUS_ITEM_FILES.meta} but no ${CORPUS_ITEM_FILES.diff} — an incomplete item, not an absent one`);
    }
    const cfPath = path.join(dir, CORPUS_ITEM_FILES.changedFiles);
    const specPath = path.join(dir, CORPUS_ITEM_FILES.issueSpec);
    return {
      meta,
      diff: readFileSync(diffPath, "utf8"),
      changedFiles: existsSync(cfPath)
        ? readFileSync(cfPath, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
        : [],
      // `null`, not `""`: "this PR closed no issue" and "the issue body was
      // blank" are different facts about the input, and a lens is given the
      // issue spec only in the first case.
      issueSpec: existsSync(specPath) ? readFileSync(specPath, "utf8") : null,
    };
  }

  /** Every item id frozen under this root, sorted. `[]` for a root with no corpus yet. */
  listCorpusItems() {
    const dir = path.join(this.root, CORPUS_DIR, "items");
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && this.hasCorpusItem(e.name))
      .map((e) => e.name)
      .sort();
  }

  /**
   * A corpus version's manifest — the named, immutable INDEX of which items make
   * up that version. Overwritable, unlike an item: it holds no observation, only
   * a list that is recomputable from the items it names. `extract-corpus.mjs`
   * merges rather than replaces, so extracting one more PR into an existing
   * version cannot silently drop the other nineteen.
   */
  putCorpusManifest(corpusVersion, manifest) {
    writeFileAtomic(this._manifestPath(corpusVersion), JSON.stringify(manifest, null, 2) + "\n");
    return "written";
  }

  getCorpusManifest(corpusVersion) {
    const p = this._manifestPath(corpusVersion);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      refuse(`corpus manifest ${corpusVersion} is unreadable: ${e.message}`);
    }
  }

  /** The item index for a corpus version, or `null` if the version does not exist. */
  getCorpus(corpusVersion) {
    const m = this.getCorpusManifest(corpusVersion);
    if (!m) return null;
    return Array.isArray(m.items) ? m.items : [];
  }

  // --- runs ------------------------------------------------------------------
  // One replay of a corpus under one config. K replicates of the same corpus and
  // config are K run ids, which is what makes reliability computable at all.

  _runDir(runId) {
    // VALIDATED, not sanitised, and the fork's store did the opposite: it ran every
    // id through a `[:/\\] → -` replace, which silently maps two distinct run ids
    // onto one directory. For a subsystem whose entire job is telling two runs
    // apart that is the worse failure — and the ids the runner generates
    // (`2026-08-06T12-00-00-000Z__baseline`) pass this grammar unchanged, so
    // nothing needed mangling in the first place.
    return path.join(this.root, RUNS_DIR, requireSegment("run id", runId));
  }

  _runItemDir(runId, itemId) {
    return path.join(this._runDir(runId), "items", requireSegment("item id", itemId));
  }

  /**
   * Write or refresh a run's summary, and freeze its config snapshot once.
   *
   * `run.json` is rewritten freely: it is a summary recomputed from the immutable
   * items on disk, so a resumed run must be able to update it.
   *
   * `config.snapshot.json` is IDENTITY, and a second snapshot that DISAGREES is
   * REFUSED rather than ignored. The fork ignored it (`// ignored (write-once)`),
   * which quietly permitted the one thing the snapshot exists to prevent: resuming
   * a run id after editing `lenses.json`, so half the items were produced by one
   * reviewer and half by another under a single run id, with `run.json` naming one
   * `config_hash` for both.
   *
   * DISAGREEMENT IS MEASURED BY `config_hash`, NOT BY BYTES, and that is not
   * laziness — it is the same trap `extract-corpus.mjs` avoided by keeping a clock
   * out of the corpus manifest. A snapshot carries `captured_at`, so two runs of an
   * identical configuration differ in bytes by construction, and a byte comparison
   * would refuse every ordinary resume. `config_hash` is what #680 built to answer
   * "is this the same configuration?", so it is what is compared; a snapshot
   * carrying no hash falls back to a canonical byte comparison, because a snapshot
   * with no identity cannot be checked any other way.
   */
  putRun(runId, { runJson, configSnapshot } = {}) {
    if (runJson === null || typeof runJson !== "object" || Array.isArray(runJson)) {
      refuse(`run ${runId}: runJson must be a JSON object, got ${JSON.stringify(runJson)}`);
    }
    if (runJson.run_id !== runId) {
      refuse(`run ${runId}: runJson.run_id is ${JSON.stringify(runJson.run_id)} — the record and the directory must agree`);
    }
    const snapPath = path.join(this._runDir(runId), RUN_FILES.configSnapshot);
    if (configSnapshot) {
      if (existsSync(snapPath)) {
        // Guarded like every other parse in this module. A raw `SyntaxError` here
        // would name neither the run nor the file, and this is the one comparison
        // that decides whether two reviewers get filed under one run id — the reader
        // needs to know it is the SNAPSHOT that is corrupt, not the offer.
        let stored;
        try {
          stored = JSON.parse(readFileSync(snapPath, "utf8"));
        } catch (e) {
          refuse(`run ${runId} has an unreadable ${RUN_FILES.configSnapshot}: ${e.message}`);
        }
        const bothHashed = typeof stored?.config_hash === "string" && typeof configSnapshot.config_hash === "string";
        const same = bothHashed
          ? stored.config_hash === configSnapshot.config_hash
          : canonicalJson(stored) === canonicalJson(configSnapshot);
        if (!same) {
          refuse(
            `run ${runId} already holds a DIFFERENT config snapshot (${stored?.config_hash ?? "unhashed"} vs ` +
              `${configSnapshot.config_hash ?? "unhashed"}) — resuming a run id under a changed configuration would ` +
              "file two reviewers' items under one run id. Use a new --run-id.",
          );
        }
      } else {
        writeFileAtomic(snapPath, JSON.stringify(configSnapshot, null, 2) + "\n");
      }
    }
    writeFileAtomic(path.join(this._runDir(runId), RUN_FILES.run), JSON.stringify(runJson, null, 2) + "\n");
    return "written";
  }

  /** A run's summary and frozen config, or `null` if the run does not exist. */
  getRun(runId) {
    const runPath = path.join(this._runDir(runId), RUN_FILES.run);
    if (!existsSync(runPath)) return null;
    let runJson;
    try {
      runJson = JSON.parse(readFileSync(runPath, "utf8"));
    } catch (e) {
      refuse(`run ${runId} has an unreadable ${RUN_FILES.run}: ${e.message}`);
    }
    const snapPath = path.join(this._runDir(runId), RUN_FILES.configSnapshot);
    // ABSENT still degrades to `null` — a run written before its snapshot landed is
    // an interrupted write, and this is the read path. PRESENT-but-corrupt throws,
    // the same split `getCorpusItemInput` and `getItem` draw: answering `null` for a
    // snapshot that exists and cannot be parsed would tell a caller "this run has no
    // config identity" when the truth is "this run's identity is unreadable", and a
    // scorer would then pool it with runs whose reviewer is actually known.
    let configSnapshot = null;
    if (existsSync(snapPath)) {
      try {
        configSnapshot = JSON.parse(readFileSync(snapPath, "utf8"));
      } catch (e) {
        refuse(`run ${runId} has an unreadable ${RUN_FILES.configSnapshot}: ${e.message}`);
      }
    }
    return { runJson, configSnapshot };
  }

  /**
   * Has this item already been replayed under this run id?
   *
   * The whole of resume rests on this one predicate, and it keys on
   * `envelope.json` because that file is written LAST — so a crash mid-item leaves
   * the item ABSENT and it is retried, rather than present-and-half-written and
   * skipped forever.
   */
  hasItem(runId, itemId) {
    return existsSync(path.join(this._runItemDir(runId, itemId), ITEM_FILES.envelope));
  }

  /**
   * Record one replayed item. WRITE-ONCE: an existing item throws.
   *
   * Unlike a corpus item — a deterministic extraction that a re-run may legitimately
   * reproduce — this is an OBSERVATION of a non-deterministic judge. A second
   * replay of the same item is a different observation and belongs under a
   * different run id; overwriting one would delete a data point and leave
   * `run.json`'s totals describing items that are no longer there. The runner calls
   * `hasItem` first, which is what makes a resumed run cost nothing.
   */
  putItem(runId, itemId, { envelope, payload } = {}) {
    validateRunEnvelope(runId, itemId, envelope);
    if (this.hasItem(runId, itemId)) {
      refuse(`run item ${runId}/${itemId} already exists (runs are write-once); a second replay is a new --run-id, not an overwrite`);
    }
    const dir = this._runItemDir(runId, itemId);
    // `payload.json` FIRST, `envelope.json` LAST — see `ITEM_FILES`.
    writeFileAtomic(path.join(dir, ITEM_FILES.payload), JSON.stringify(payload ?? null, null, 2) + "\n");
    writeFileAtomic(path.join(dir, ITEM_FILES.envelope), JSON.stringify(envelope, null, 2) + "\n");
    return "written";
  }

  /**
   * One replayed item, or `null` if it was never replayed.
   *
   * The two failures split exactly as `getCorpusItemInput`'s do, for the same
   * reason: an absent item is an ordinary state, while an item that is PRESENT and
   * unreadable silently shrinks a run — and every proportion computed downstream
   * would then carry an `n` that is wrong.
   */
  getItem(runId, itemId) {
    const dir = this._runItemDir(runId, itemId);
    const envPath = path.join(dir, ITEM_FILES.envelope);
    if (!existsSync(envPath)) return null;
    let envelope;
    try {
      envelope = JSON.parse(readFileSync(envPath, "utf8"));
    } catch (e) {
      refuse(`run item ${runId}/${itemId} has an unreadable ${ITEM_FILES.envelope}: ${e.message}`);
    }
    const payloadPath = path.join(dir, ITEM_FILES.payload);
    if (!existsSync(payloadPath)) {
      refuse(`run item ${runId}/${itemId} has ${ITEM_FILES.envelope} but no ${ITEM_FILES.payload} — an incomplete item, not an absent one`);
    }
    let payload;
    try {
      payload = JSON.parse(readFileSync(payloadPath, "utf8"));
    } catch (e) {
      refuse(`run item ${runId}/${itemId} has an unreadable ${ITEM_FILES.payload}: ${e.message}`);
    }
    return { envelope, payload };
  }

  /**
   * Which panel every record under these run ids states, as `{id, panelDigest}` — the
   * input `resolvePanelDigest` decides a cross-run score's key from.
   *
   * THE ITEMS AND NOT ONLY THE RUNS, because the mixture that motivated this is
   * WITHIN a run: the live-ingested agent-PR run is one run id whose 16 item envelopes
   * are 5 panels by content. Reading only `run.json` would have answered "one panel"
   * about exactly the data that is not.
   *
   * It lives here rather than in the caller because the layout is this module's — a
   * second walk over `runs/<id>/items/` written in `report.mjs` is the kind of
   * duplicate that drifts into disagreeing about which files count. A READ PATH, so it
   * degrades: a run id that does not exist contributes no records rather than throwing,
   * and `resolvePanelDigest` refuses on the empty list, which is the same refusal one
   * step later and with a message about the right thing.
   */
  panelDigestRecords(runIds = []) {
    const out = [];
    for (const runId of Array.isArray(runIds) ? runIds : []) {
      const run = this.getRun(runId);
      if (run === null) continue;
      out.push({ id: `${runId}/${RUN_FILES.run}`, panelDigest: run.runJson?.panel_digest });
      for (const itemId of this.listItems(runId)) {
        out.push({ id: `${runId}/${itemId}`, panelDigest: this.getItem(runId, itemId)?.envelope?.panel_digest });
      }
    }
    return out;
  }

  /** Every complete item under a run id, sorted. `[]` for a run with none yet. */
  listItems(runId) {
    const dir = path.join(this._runDir(runId), "items");
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && this.hasItem(runId, e.name))
      .map((e) => e.name)
      .sort();
  }

  /**
   * Run ids, optionally narrowed to one `(configHash, corpusVersion)` group — the
   * K replicates a cross-run reliability scorer aggregates over.
   *
   * A read path, so it degrades: a directory whose `run.json` is missing or
   * unreadable is skipped rather than thrown on. `panelSha` is offered as a filter
   * because `config_hash` alone does not identify the reviewer, so a caller
   * aggregating "the same reviewer" must be able to say so. `panelDigest` is the same
   * filter over the CONTENT identity, and it is the one a cross-run scorer wants: the
   * sha separates panels that are byte-identical, and the runs a score may pool are
   * exactly the ones sharing the digest its path is keyed by.
   */
  listRuns({ configHash, corpusVersion, panelSha, panelDigest } = {}) {
    const dir = path.join(this.root, RUNS_DIR);
    if (!existsSync(dir)) return [];
    const out = [];
    for (const seg of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      let rj;
      try {
        rj = JSON.parse(readFileSync(path.join(dir, seg, RUN_FILES.run), "utf8"));
      } catch {
        continue;
      }
      if (configHash && rj.config_hash !== configHash) continue;
      if (corpusVersion && rj.corpus_version !== corpusVersion) continue;
      if (panelSha && rj.panel_sha !== panelSha) continue;
      if (panelDigest && rj.panel_digest !== panelDigest) continue;
      out.push(rj.run_id ?? seg);
    }
    return out;
  }

  // --- scores ----------------------------------------------------------------
  // Metrics over the runs above. The runs are immutable; these are not. See
  // `SCORES_DIR`, which is where that exception is argued.

  /**
   * Where one score file lives, from its scope and its key.
   *
   * Every component is a PATH SEGMENT and every one of them is validated rather
   * than sanitised, `requireSegment` being the validator the run ids and item ids
   * already use. `<scorer id>` in particular arrives from a command line, and
   * `scores/…/../../../etc/passwd.json` built from an unvalidated one is a
   * traversal out of the store.
   *
   * The two scopes need DIFFERENT keys and neither is optional, so each refuses
   * separately: a `per-run` score with no run id and a `cross-run` score with no
   * config hash are both callers who have not said what their number is about.
   *
   * `panelDigest` is required on the cross-run branch for the same reason and by the
   * same argument — see `byConfigSegment`. A `per-run` score does not take one because
   * it does not need one: it is keyed by a run id whose envelopes pin their own panel,
   * which is the property this method's cross-run branch previously only claimed.
   */
  _scorePath({ scorerId, scope, runId = null, configHash = null, panelDigest = null, corpusVersion = null } = {}) {
    requireSegment("scorer id", scorerId);
    if (!SCORE_SCOPES.includes(scope)) {
      refuse(`score ${scorerId}: scope must be one of ${SCORE_SCOPES.join(" | ")}, got ${JSON.stringify(scope)}`);
    }
    const file = `${scorerId}.json`;
    if (scope === "per-run") {
      return path.join(this.root, SCORES_DIR, SCORE_SCOPE_DIRS["per-run"], requireSegment("run id", runId), file);
    }
    return path.join(this.root, SCORES_DIR, SCORE_SCOPE_DIRS["cross-run"], byConfigSegment(configHash, panelDigest, corpusVersion), file);
  }

  /**
   * File one metric. 🔴 OVERWRITES — a re-score replaces its predecessor.
   *
   * That is the opposite of `putCorpusItem` and `putItem`, and the argument is at
   * `SCORES_DIR`: a score is a derivation over runs that cannot themselves move, so
   * recomputing it is the cheap half of this benchmark and refusing the second
   * write would make a metric change unfilable. #780 is the worked example — it
   * moved 219 defect classes to 245 with no model call.
   *
   * The one thing an overwrite must not silently do is cross reviewers.
   *
   * 🔴 THIS DOCBLOCK USED TO SAY THAT WAS FREE, AND THAT IS WHY IT WAS NOT CHECKED.
   * It read: "a `cross-run` score is keyed by `(config_hash, corpus_version)` … so a
   * score computed under a different reviewer lands in a different file by
   * construction". The premise was true and the conclusion did not follow —
   * `config-hash.mjs` says in its own header that it cannot see the panel's code, so
   * two panels produced ONE directory name and the second score overwrote the first.
   * Measured: one ingested run pools 16 items that are 5 panels by content under a
   * single `config_hash`. The sentence was in the right file, next to the right code,
   * and it was read as reassurance instead of as a claim to check.
   *
   * So the property is now built rather than asserted, in two places that have to
   * agree: `byConfigSegment` puts `panel_digest` in the PATH, and the check below
   * makes a cross-run payload state the panel it was filed under. A `per-run` score
   * needs neither — it is keyed by a run id whose envelopes pin their own panel, which
   * is the version of this argument that was always sound.
   *
   * WHY THE PAYLOAD IS CHECKED AND NOT STAMPED. This is the single write path and it
   * refuses on doubt rather than repairing: a caller that files a number without
   * saying whose it is has not decided what the number is about, and writing the
   * answer in for them would make the path the only record of it. A score file read
   * back out of git, on its own, must be able to say which panel produced it.
   *
   * Written atomically, like every other write on this surface: a half-written
   * `reliability-v1.json` that parses is a metric nobody can distinguish from a
   * complete one.
   */
  putScore({ scorerId, scope, runId = null, configHash = null, panelDigest = null, corpusVersion = null } = {}, score) {
    validateScore(scorerId, scope, score);
    if (scope === "cross-run") validateScorePanel(scorerId, panelDigest, score);
    const abs = this._scorePath({ scorerId, scope, runId, configHash, panelDigest, corpusVersion });
    writeFileAtomic(abs, JSON.stringify(score, null, 2) + "\n");
    return abs;
  }

  /**
   * One stored metric, or `null` if it was never computed.
   *
   * A READ PATH, so it degrades — and here the degradation carries meaning the
   * caller must not lose. `null` is exactly "no scorer has written this", which is
   * the state of `cost-latency-v1` (#791, unmerged) and of a segmentation grid
   * nobody has built. A renderer reads that as **not computed** and must render it
   * as such, never as a zero and never as a blank cell: a scorer that never ran and
   * a scorer that ran and found nothing are different facts, and pooling them is
   * lesson 6.
   *
   * PRESENT-but-unparseable throws, the same split `getItem` and
   * `getCorpusItemInput` draw. Answering `null` for a score file that exists and is
   * corrupt would tell a renderer "nobody measured this" when the truth is "the
   * measurement is unreadable", and the report would then print *"not computed"*
   * about a number that is sitting right there.
   */
  getScore({ scorerId, scope, runId = null, configHash = null, panelDigest = null, corpusVersion = null } = {}) {
    const abs = this._scorePath({ scorerId, scope, runId, configHash, panelDigest, corpusVersion });
    if (!existsSync(abs)) return null;
    try {
      return JSON.parse(readFileSync(abs, "utf8"));
    } catch (e) {
      refuse(`score ${scorerId} at ${abs} is unreadable: ${e.message}`);
    }
  }

  // --- reports ---------------------------------------------------------------

  /**
   * Write one rendered comparison. Returns the absolute path, which is the only
   * thing a caller wants back and is what the CLI prints.
   *
   * `<comparison id>` becomes a PATH SEGMENT and is validated by `requireSegment`
   * for the reason `_scorePath` gives: `reports/../../README.md` built from an
   * unvalidated id overwrites a file outside the store. The id is not invented
   * either — see `report.mjs`, which derives it from `(config_hash,
   * corpus_version)` so a report names the reviewer pair its figures came from.
   *
   * An EMPTY report is refused. A report is the one artifact in this store with a
   * human audience, and a zero-byte file at a path that exists reads as "the
   * comparison produced nothing to say" rather than as the failed render it is.
   */
  putReport(comparisonId, markdown) {
    requireSegment("comparison id", comparisonId);
    if (typeof markdown !== "string" || markdown.trim() === "") {
      refuse(`report ${comparisonId} is empty — a report nobody can read is worse than a report that is absent`);
    }
    const abs = path.join(this.root, REPORTS_DIR, `${comparisonId}.md`);
    writeFileAtomic(abs, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    return abs;
  }
}
