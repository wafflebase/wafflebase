// GitFsStore — the ArtifactStore implementation over a local checkout of the
// results repo (wafflebase-agent-eval). Pure fs + gzip; git commit is a separate
// concern (optional `commit()` helper). Swapping to an object store later = a new
// class with the same surface — the runner/scorer/adapter never change.
//
// Contract highlights (schema doc §4):
//   - runs/ is write-once at the ITEM level: putItem throws if the item exists
//     (use hasItem to skip on resume). run.json is a mutable status summary of an
//     immutable item set; config.snapshot.json is write-once (it is identity).
//   - scores/ is re-scoreable (overwrite ok): per-run vs by-config by scope.
//   - transcripts are gzip-compressed on disk (git-bloat guard).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";

// Colon is legal in POSIX paths but not on all filesystems; keep segments safe
// (config_hash carries a "sha256:" prefix that becomes "sha256-" on disk).
const safeSeg = (s) => String(s).replace(/[:/\\]/g, "-");

export class GitFsStore {
  constructor(root) {
    if (!root) throw new Error("GitFsStore needs a results-repo root path");
    this.root = path.resolve(root);
  }

  _p(...parts) { return path.join(this.root, ...parts); }
  _readJson(p) { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; }
  _writeJson(p, obj) {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
  }

  // --- runs -----------------------------------------------------------------

  _runDir(runId) { return this._p("runs", safeSeg(runId)); }
  _itemDir(runId, itemId) { return path.join(this._runDir(runId), "items", safeSeg(itemId)); }

  /** Write/refresh run.json; write config.snapshot.json once (identity). */
  putRun(runId, { runJson, configSnapshot }) {
    this._writeJson(path.join(this._runDir(runId), "run.json"), runJson);
    const snapPath = path.join(this._runDir(runId), "config.snapshot.json");
    if (configSnapshot && !existsSync(snapPath)) this._writeJson(snapPath, configSnapshot);
  }

  getRun(runId) {
    const runJson = this._readJson(path.join(this._runDir(runId), "run.json"));
    if (!runJson) return null;
    return { runJson, configSnapshot: this._readJson(path.join(this._runDir(runId), "config.snapshot.json")) };
  }

  hasItem(runId, itemId) {
    return existsSync(path.join(this._itemDir(runId, itemId), "envelope.json"));
  }

  /** Write-once per item. Throws if it already exists (immutability); the runner
   * calls hasItem() to skip already-done items on resume. `transcript` is any
   * JSON value, stored gzip-compressed. */
  putItem(runId, itemId, { envelope, payload, transcript }) {
    if (this.hasItem(runId, itemId)) {
      throw new Error(`putItem: ${runId}/${itemId} already written (runs/ is write-once)`);
    }
    const dir = this._itemDir(runId, itemId);
    this._writeJson(path.join(dir, "envelope.json"), envelope);
    this._writeJson(path.join(dir, "payload.json"), payload);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "transcript.json.gz"), gzipSync(Buffer.from(JSON.stringify(transcript ?? null))));
  }

  getItem(runId, itemId) {
    const dir = this._itemDir(runId, itemId);
    const envelope = this._readJson(path.join(dir, "envelope.json"));
    if (!envelope) return null;
    const payload = this._readJson(path.join(dir, "payload.json"));
    const tPath = path.join(dir, "transcript.json.gz");
    const transcript = existsSync(tPath) ? JSON.parse(gunzipSync(readFileSync(tPath)).toString("utf8")) : null;
    return { envelope, payload, transcript };
  }

  listItems(runId) {
    const dir = path.join(this._runDir(runId), "items");
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  }

  /** Run ids, optionally filtered to a (configHash, corpusVersion) group — the
   * replicates a cross-run reliability scorer aggregates over. */
  listRuns({ configHash, corpusVersion } = {}) {
    const dir = this._p("runs");
    if (!existsSync(dir)) return [];
    const out = [];
    for (const seg of readdirSync(dir).sort()) {
      const rj = this._readJson(path.join(dir, seg, "run.json"));
      if (!rj) continue;
      if (configHash && rj.config_hash !== configHash) continue;
      if (corpusVersion && rj.corpus_version !== corpusVersion) continue;
      out.push(rj.run_id ?? seg);
    }
    return out;
  }

  // --- scores (re-scoreable) ------------------------------------------------

  _scorePath({ scope, runId, configHash, corpusVersion }, scorerId) {
    if (scope === "per-run") return this._p("scores", "per-run", safeSeg(runId), `${safeSeg(scorerId)}.json`);
    if (scope === "cross-run") {
      return this._p("scores", "by-config", `${safeSeg(configHash)}__${safeSeg(corpusVersion)}`, `${safeSeg(scorerId)}.json`);
    }
    throw new Error(`putScore/getScore: scope must be "per-run" or "cross-run" (got ${scope})`);
  }

  putScore(key, scorerId, scoreJson) { this._writeJson(this._scorePath(key, scorerId), scoreJson); }
  getScore(key, scorerId) { return this._readJson(this._scorePath(key, scorerId)); }

  // --- configs (judge manifests, config-as-code) ----------------------------

  putConfig(configId, manifest) { this._writeJson(this._p("configs", `${safeSeg(configId)}.json`), manifest); }
  getConfig(configId) { return this._readJson(this._p("configs", `${safeSeg(configId)}.json`)); }

  // --- corpus ---------------------------------------------------------------

  _corpusItemDir(itemId) { return this._p("corpus", "items", safeSeg(itemId)); }

  /** Store one frozen corpus item's inputs. `issueSpec` optional. */
  putCorpusItem(itemId, { meta, diff, changedFiles, issueSpec }) {
    const dir = this._corpusItemDir(itemId);
    this._writeJson(path.join(dir, "meta.json"), meta);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "diff.patch"), String(diff ?? ""));
    writeFileSync(path.join(dir, "changed-files.txt"), (changedFiles ?? []).join("\n") + "\n");
    if (issueSpec != null && issueSpec !== "") writeFileSync(path.join(dir, "issue-spec.md"), String(issueSpec));
  }

  /** Read one item's inputs for the runner (diff/changed-files/issue-spec). */
  getCorpusItemInput(itemId) {
    const dir = this._corpusItemDir(itemId);
    const metaPath = path.join(dir, "meta.json");
    if (!existsSync(metaPath)) return null;
    const issuePath = path.join(dir, "issue-spec.md");
    const cfPath = path.join(dir, "changed-files.txt");
    return {
      meta: this._readJson(metaPath),
      diff: readFileSync(path.join(dir, "diff.patch"), "utf8"),
      changedFiles: existsSync(cfPath) ? readFileSync(cfPath, "utf8").split("\n").map((s) => s.trim()).filter(Boolean) : [],
      issueSpec: existsSync(issuePath) ? readFileSync(issuePath, "utf8") : null,
    };
  }

  // Corpus versions are named, immutable snapshots → one manifest file per
  // version (corpus/manifests/<version>.json), items shared under corpus/items/.
  putCorpusManifest(corpusVersion, manifestJson) {
    this._writeJson(this._p("corpus", "manifests", `${safeSeg(corpusVersion)}.json`), manifestJson);
  }

  /** The item index for a corpus version (its manifest's `items` array). */
  getCorpus(corpusVersion) {
    const m = this._readJson(this._p("corpus", "manifests", `${safeSeg(corpusVersion)}.json`));
    return m ? (Array.isArray(m.items) ? m.items : []) : null;
  }

  // --- labels (Track B — reserved) ------------------------------------------

  getLabels(corpusVersion, itemId) {
    return this._readJson(this._p("labels", safeSeg(corpusVersion), `${safeSeg(itemId)}.json`));
  }
}
