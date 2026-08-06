// Where a FROZEN CORPUS ITEM lands — and the one surface the eval data root is
// reached through, whether what you want is a corpus item or a collected capture.
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
//   2. When PR 5 records run envelopes, a transcript is referenced by a POINTER
//      (a local path, later an S3 key) carried in the envelope, and any reader
//      of one must return a NAMED state — `{state: "absent" | "local" |
//      "remote"}` — never `null`, never `""`. A falsy value is
//      indistinguishable from an empty transcript, and the difference between
//      "we did not keep it" and "there was nothing to keep" is exactly what a
//      person debugging a weird verdict needs to know.
//
// So: absence is normal, absence is never an error, and absence must never be
// spellable as a falsy value.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { createCaptureStore } from "../capture-store.mjs";

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
}
