// Did THIS change introduce the code a finding points at? Answered with git, not
// with a model.
//
// WHY THIS EXISTS. #573 deliberately stopped handing the verifier the diff: the
// lens that raised a finding reasoned FROM the diff, so a verifier reading the
// same diff inherits its misreadings. That independence is right and stays. But
// it leaves the verifier standing inside the branch checkout with no view of the
// base — and from there a line a refactor MOVED and a line the change WROTE are
// byte-identical. The `pre-existing` refutation ground is file-scoped ("lives in
// a file this change did not touch"), so a function relocated into a new file
// legitimately fails it, and every finding on moved code is reported as new.
//
// That happened on #578: a PR that lifted `classifyResult` verbatim out of
// review-panel.mjs into ask.mjs had every pre-existing bug in that function
// re-reported as introduced-here, and the verifier confirmed them all because,
// from where it stands, they ARE present.
//
// `git blame -w -C -C -C` answers this exactly: it follows a line back through
// moves and copies to the commit that WROTE it, not the one that moved it. On
// #578's `resets?\b` regex, plain blame says the PR commit; move-aware blame
// says a commit that predates the base. No model is needed or wanted here.
//
// THE ONE RULE: every uncertain path returns `unknown`, and `unknown` keeps the
// finding blocking — i.e. exactly today's behaviour. This module can only ever
// REMOVE a false blocker; there is no path by which it loses a real one.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCitation } from "./citation.mjs";

/**
 * Where the code a finding points at came from.
 *   introduced   — written by this change
 *   relocated    — moved/copied here by this change; the code itself is older
 *   pre-existing — lives in code this change did not touch
 *   unknown      — could not tell (no location, no base, git unavailable/failed)
 * `introduced` and `unknown` both keep a finding blocking; the difference is
 * diagnostic only, so mislabelling one as the other is never a gate error.
 */
export const ORIGINS = ["introduced", "relocated", "pre-existing", "unknown"];

const SHA = /^[0-9a-fA-F]{7,40}$/;

// `blame -C -C -C` searches for copies across every file in the commit, which on
// a large file with deep history is the one genuinely slow call here. A finding
// that costs more than this to place is not worth the wall-clock: it degrades to
// `unknown`, which is the status quo.
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

// The content probe (below) asks whether a line's exact text already exists in
// the base tree. On a SHORT or structural line that question is meaningless —
// `}`, `});`, `*/` and `return null;` occur in almost any tree, so every finding
// touching one would probe as "already in base" and be demoted off the gate.
// That is the one way this module could lose a real finding, so the probe is
// only consulted for lines distinctive enough for a match to mean something:
// long enough, and carrying at least two identifier-ish runs.
const MIN_PROBE_LEN = 16;
const IDENTIFIER_RUN = /[A-Za-z_][A-Za-z0-9_]{2,}/g;
const MIN_PROBE_IDENTIFIERS = 2;

/** Is this line worth asking `git grep -F` about? See MIN_PROBE_LEN. */
export function isProbeableLine(text) {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (t.length < MIN_PROBE_LEN) return false;
  return (t.match(IDENTIFIER_RUN) ?? []).length >= MIN_PROBE_IDENTIFIERS;
}

/**
 * The whole decision table, as a pure function — this is what the tests pin.
 *
 * Direction of every default: toward `unknown`, which keeps a finding blocking.
 * Note that `introduced` is ALSO a blocking outcome, which is what lets the last
 * branch be unconditional: once a probe has run and neither says "this code is
 * older than the base", the conservative answer and the accurate answer agree.
 * Only an affirmative "older" demotes, and only a probe can produce one.
 */
export function originFrom({
  hasLocation = false,
  probesFailed = false,
  blameIsAncestorOfBase = null,
  fileExistedInBase = null,
  contentFoundInBase = null,
} = {}) {
  // Nothing to place, or neither probe could run: we cannot tell.
  if (!hasLocation || probesFailed) return "unknown";
  // Blame is the precise probe: it followed this line to the commit that wrote
  // it, and that commit is reachable from the base. The code predates the change.
  if (blameIsAncestorOfBase === true) {
    // Old line, new file → the change moved it here. Old line, old file → the
    // change never touched it. When the file's fate is unknown, say the weaker
    // thing (`pre-existing` claims nothing about the change having moved it);
    // both route identically, so this only affects how the finding reads.
    return fileExistedInBase === false ? "relocated" : "pre-existing";
  }
  // Blame said "written here", or could not run. The content probe gets a second
  // chance to spot a move blame missed (it survives a shallow clone, which blame
  // does not) — but only on a distinctive line; see isProbeableLine.
  if (contentFoundInBase === true) return "relocated";
  return "introduced";
}

/**
 * Where does a finding point? `line` if the lens supplied one, else the first
 * `file:line` citation in its evidence, else the file alone.
 *
 * Returns `{file, line}` with `line: null` when only a file could be resolved,
 * or `null` when not even that — both of which land on a non-demoting path in
 * `noveltyOf`, so a lens that omits locations costs precision, never safety.
 */
export function findingLocation(finding) {
  if (!finding || typeof finding !== "object") return null;
  const file = typeof finding.file === "string" && finding.file.trim() ? finding.file.trim() : null;
  if (Number.isInteger(finding.line) && finding.line >= 1 && file) {
    return { file, line: finding.line };
  }
  const cited = parseCitation(finding.evidence);
  // Trust the finding's own `file` over the citation's path when both exist: the
  // citation is prose the model wrote and may name a file it was merely
  // discussing, while `file` is the field the gate and the fixer already key on.
  if (cited) return { file: file ?? cited.file, line: cited.line };
  return file ? { file, line: null } : null;
}

/**
 * Run git. Never throws: returns `{ok:false}` on any failure, including timeout.
 *
 * `status` is carried out because some git commands use the exit code as an
 * ANSWER rather than as an error — `grep` exits 1 for "no match", `merge-base
 * --is-ancestor` exits 1 for "no". Callers must be able to tell that from a
 * command that could not run at all, or a broken lookup gets recorded as a
 * confident negative. `null` means the process did not produce an exit status
 * (spawn failure or timeout), which is never an answer.
 */
function git(args, repo) {
  try {
    const stdout = execFileSync("git", args, {
      cwd: repo,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, status: 0, stdout };
  } catch (e) {
    return { ok: false, status: typeof e?.status === "number" ? e.status : null, stdout: "" };
  }
}

/** `git blame -w -C -C -C` for one line → the sha that WROTE it, or null. */
function blameSha(repo, file, line) {
  // -w ignores whitespace changes, -C -C -C looks for the line's origin in other
  // files in the same commit, in files that commit modified, and in the original
  // commit — the three levels that between them catch a refactor's moves.
  // `--` before the path so a file named like a rev cannot be misread as one.
  const r = git(["blame", "-w", "-C", "-C", "-C", "-L", `${line},${line}`, "--porcelain", "HEAD", "--", file], repo);
  if (!r.ok) return null;
  const first = r.stdout.split("\n", 1)[0] ?? "";
  const sha = first.split(" ", 1)[0] ?? "";
  return SHA.test(sha) ? sha : null;
}

/**
 * Is `sha` reachable from `baseSha`? `--is-ancestor` exits 0 for yes, 1 for no,
 * and non-zero-non-1 for an error — which `git()` flattens to `ok:false`. That
 * flattening is why this returns null (unknown) rather than false on error: a
 * failed lookup must not read as "not an ancestor", which would demote nothing
 * but would let the content probe conclude `introduced` on no evidence.
 */
function isAncestor(repo, sha, baseSha) {
  if (!sha) return null;
  const r = git(["merge-base", "--is-ancestor", sha, baseSha], repo);
  if (r.ok) return true;
  // Exit 1 is git's ANSWER ("no"); any other status, or none, means the lookup
  // itself broke (unknown rev on a shallow clone, timeout) and must not be
  // recorded as a confident "not an ancestor" — that would let the content probe
  // conclude `introduced` on evidence that was never gathered.
  return r.status === 1 ? false : null;
}

/**
 * Answer "where did this code come from" for one finding location.
 *
 * `baseSha` is passed in, never guessed: this script has no idea what the base
 * branch is called, and a wrong guess would silently mis-date every finding.
 * Absent or malformed → `unknown` for everything, i.e. today's behaviour.
 *
 * `cache` is a caller-supplied Map. The same finding is verified twice per round
 * (the fresh pass and the prior-round re-check), and `blame -C -C -C` is the
 * expensive call here.
 */
export function noveltyOf({ repo, file, line, baseSha, changedFiles, changedFilesAuthoritative = false, cache }) {
  const unknown = { origin: "unknown", blameSha: null, alsoAt: null };
  if (!repo || typeof file !== "string" || !file.trim()) return unknown;
  if (typeof baseSha !== "string" || !SHA.test(baseSha)) return unknown;

  // No line number: the only sound call left is the file-scoped one the verifier
  // prompt already makes — and only when the changed-file list is complete, for
  // the same reason `isDroppingVerdict` gates `pre-existing` on it. A file absent
  // from a TRUNCATED list is not untouched, merely unlisted.
  if (!Number.isInteger(line) || line < 1) {
    if (changedFilesAuthoritative && Array.isArray(changedFiles) && !changedFiles.includes(file)) {
      return { origin: "pre-existing", blameSha: null, alsoAt: null };
    }
    return unknown;
  }

  const key = `${file}:${line}`;
  if (cache instanceof Map && cache.has(key)) return cache.get(key);

  const sha = blameSha(repo, file, line);
  const blameIsAncestorOfBase = isAncestor(repo, sha, baseSha);

  // Only look up the file's fate when blame already established the line is old
  // — it is purely a label refinement (pre-existing vs relocated), and both route
  // to the same lane.
  const fileExistedInBase = blameIsAncestorOfBase === true
    ? git(["cat-file", "-e", `${baseSha}:${file}`], repo).ok
    : null;

  // Content probe: does this exact line already exist anywhere in the base tree?
  // Independent of blame and, unlike blame, it needs only the base tree object —
  // so it still answers on a shallow clone. Run when blame did NOT conclude (it
  // is the second chance to spot a move), and ALSO when blame said "relocated",
  // where it is not deciding anything — it is fetching the base location for the
  // report, because "this line already lives at review-panel.mjs:436" is the
  // evidence that makes a demotion checkable by eye, and a bare sha is not.
  // Skipped for `pre-existing` (same file, so the location adds nothing) and on
  // non-distinctive lines.
  let contentFoundInBase = null;
  let alsoAt = null;
  if (blameIsAncestorOfBase !== true || fileExistedInBase === false) {
    const shown = git(["show", `HEAD:${file}`], repo);
    const text = shown.ok ? (shown.stdout.split("\n")[line - 1] ?? "") : "";
    if (shown.ok && isProbeableLine(text)) {
      const hit = git(["grep", "-F", "-n", "--max-count", "1", "-e", text.trim(), baseSha], repo);
      // Exit 0 = found, exit 1 = definitively absent, anything else (or no exit
      // status at all) = the probe could not run, which is `null`, not "absent".
      // Collapsing those would report a broken lookup as `introduced` and hide
      // the failure from `unknownOrigin`, the counter whose whole job is to say
      // when the gate is flying blind.
      contentFoundInBase = hit.ok ? hit.stdout.trim() !== "" : hit.status === 1 ? false : null;
      if (contentFoundInBase) alsoAt = hit.stdout.split("\n", 1)[0]?.trim() ?? null;
    }
  }

  const origin = originFrom({
    hasLocation: true,
    // Both probes came back with nothing usable → we learned nothing at all.
    probesFailed: blameIsAncestorOfBase === null && contentFoundInBase === null,
    blameIsAncestorOfBase,
    fileExistedInBase,
    contentFoundInBase,
  });
  const result = { origin, blameSha: sha, alsoAt };
  if (cache instanceof Map) cache.set(key, result);
  return result;
}

// --- dry run -----------------------------------------------------------------
// `node novelty.mjs --findings <json> --base-sha <sha> [--repo <dir>]`
//
// Prints the origin this module would assign to each finding, without running a
// panel or spending a token. This exists so a change to the probes can be
// checked against a REAL past review rather than only against fixtures: replay
// the findings from a PR whose disposition is already known and confirm the
// pre-existing ones come out `relocated`/`pre-existing` and the genuinely new
// ones come out `introduced`. Fixtures pin the decision table; this pins that
// the probes feeding it read the repository correctly.
//
// Reads only; writes nothing but stdout.
async function dryRun(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  const { readFileSync } = await import("node:fs");
  const repo = args.repo ?? process.cwd();
  const baseSha = args["base-sha"];
  if (!args.findings || !baseSha) {
    console.error("usage: node novelty.mjs --findings <json> --base-sha <sha> [--repo <dir>]");
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(args.findings, "utf8"));
  const findings = Array.isArray(raw) ? raw : (raw.findings ?? []);
  const cache = new Map();
  const tally = {};
  for (const f of findings) {
    const loc = findingLocation(f);
    const r = loc
      ? noveltyOf({ repo, file: loc.file, line: loc.line, baseSha, cache })
      : { origin: "unknown", blameSha: null, alsoAt: null };
    tally[r.origin] = (tally[r.origin] ?? 0) + 1;
    const at = loc ? `${loc.file}:${loc.line ?? "?"}` : "(unlocatable)";
    console.log(`${r.origin.padEnd(13)} ${String(f.severity ?? "?").padEnd(9)} ${at}`);
    console.log(`              ${String(f.summary ?? "").slice(0, 100)}`);
    if (r.alsoAt) console.log(`              already at ${r.alsoAt.split(":").slice(0, 3).join(":")}`);
  }
  console.log(`\n${findings.length} finding(s): ${JSON.stringify(tally)}`);
}

// Only when executed directly — same guard as review-panel.mjs, so importing
// this module for tests (or from the panel) never starts a dry run.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dryRun(process.argv).catch((e) => { console.error(e.message); process.exit(1); });
}
