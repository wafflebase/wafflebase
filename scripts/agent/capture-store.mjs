// Where a collected stage-detail capture LANDS: three methods over a root
// directory, and nothing else.
//
// WHY A MODULE AND NOT THREE `fs` CALLS IN THE COLLECTOR. This is the seam that
// S3 drops into. The collector-and-S3 design puts the corpus in a bucket; the
// benchmark spec (§8) overrides that to "a folder in the repo, S3 as a later
// migration", precisely because a bucket needs a new credential path, an IAM
// role and an OIDC trust policy that do not exist yet. Both readings agree on
// the key layout, so the migration is a path transform behind these three
// methods rather than a rewrite of every call site. Three direct `writeFileSync`
// calls sprinkled through the collector would have to be found and replaced; one
// module gets a second implementation.
//
// THE ONE INVARIANT THIS FILE OWNS: **write-once per key.** The key carries the
// producing run and attempt (see `keyFor` in collect-captures.mjs), so a key
// identifies exactly one execution of the panel and its bytes never legitimately
// change. That single property is what makes re-running the collector, two
// collectors racing, and a wide `--since` re-scan all the same harmless
// operation — the S3 design's invariant B and C in the shape a filesystem can
// express, the direct analogue of the `If-None-Match: *` conditional PUT the S3
// version will use.
//
// WRITE TO A TEMP FILE AND RENAME, rather than `writeFileSync(key, …, "wx")`
// straight onto the key. `wx` is the tidier expression of write-once and it is
// the WRONG trade here: a crash or an ENOSPC part-way through it leaves a
// TRUNCATED file at the real key, and `hasCapture` then reports that corpse as
// collected — forever, because write-once will never overwrite it. That is this
// subsystem's signature failure (something looks collected and is not) rebuilt
// inside the module meant to prevent it. `rename` within a directory is atomic,
// so a key is only ever absent or complete, and the temp file itself is opened
// `wx` so two processes cannot share one. The cost is that two collectors racing
// on the same key both rename instead of one losing — which is harmless, because
// an idempotent key means both are writing byte-identical content.
//
// FAIL DIRECTION. `hasCapture` and `listCaptures` are read paths and degrade to
// "no" and "[]" on a missing root — a store that does not exist yet is the
// normal first-run case, not a fault. `putCapture` is the single write path and
// refuses on any doubt, because a capture written to the wrong path is worse
// than one not written: the artifact still exists for its retention window and a
// later run can retry, whereas a mis-keyed file corrupts the corpus silently.

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * THERE IS NO DEFAULT ROOT, and that is the point.
 *
 * An earlier draft defaulted to `scripts/agent/eval/captures` — a path inside
 * THIS repository — on the strength of spec §8's "everything starts in a folder
 * in wafflebase". The store then moved out to the separate eval repo, for a
 * reason that makes a default actively dangerous rather than merely stale: **git
 * history is permanent.** A single `--write` with a forgotten `--root` would
 * commit capture data into `wafflebase` for good, and no later `git rm` shrinks
 * anyone's clone without a history rewrite. That is a decision worth making
 * deliberately and not one worth making by omitting a flag.
 *
 * So the caller names the location, every time, and a missing one is a refusal
 * rather than a guess. The location is also genuinely not this module's to know
 * any more: it is a folder in the eval repo today and an S3 prefix later, and
 * both are the caller's business.
 */
function requireRoot(root) {
  if (typeof root !== "string" || root.trim() === "") {
    throw new Error(
      "capture store: a root directory is required — there is no default, because a forgotten " +
        "one would write capture data into whichever repository the code happens to live in, permanently.",
    );
  }
  return path.resolve(root);
}

/**
 * One key segment. Deliberately narrow: lowercase-ish alphanumerics plus the
 * three punctuation marks the key scheme actually uses (`=` for the Athena-style
 * `key=value` partitions, `-` for lens slugs, `.` for the `.json` suffix).
 *
 * `.` is allowed INSIDE a segment but a segment may not BE `.` or `..`, which is
 * checked separately below — `[A-Za-z0-9]` as the first character already
 * excludes both, and the explicit check exists so the refusal names traversal
 * rather than "bad character".
 */
const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._=-]*$/;

/**
 * The in-progress marker, defined ONCE because two places depend on it agreeing:
 * `putCapture` writes `<key>${PART_MARK}<pid>` and `listCaptures` filters those
 * out. Written as two independent expressions they can drift, and the drift is
 * silent in the worst direction — a leftover temp file starts being reported as a
 * collected capture, so the expiry warning marks its run collected when the real
 * key was never renamed into place.
 *
 * No legitimate key can contain it: every key ends `meta.json` or `<lens>.json`.
 */
const PART_MARK = ".part-";

/**
 * A key is a relative POSIX path and is validated segment by segment, not by
 * `path.resolve` containment alone.
 *
 * Containment is checked too, as a second line — but only as a second line. A
 * resolve-and-compare check passes for `pr=..%2f..` on one platform and fails on
 * another, and it accepts an absolute Windows path (`C:\x`) that `path.resolve`
 * on POSIX treats as a filename. The segment grammar is the rule; containment
 * catches whatever the grammar's author did not think of.
 */
function resolveKey(root, key) {
  if (typeof key !== "string" || key === "") {
    throw new Error(`capture store: key must be a non-empty string, got ${JSON.stringify(key)}`);
  }
  if (key.includes("\\")) throw new Error(`capture store: key must use / separators, got ${JSON.stringify(key)}`);
  if (key.startsWith("/")) throw new Error(`capture store: key must be relative, got ${JSON.stringify(key)}`);
  if (key.includes("\0")) throw new Error(`capture store: key contains a NUL byte`);
  const segments = key.split("/");
  for (const seg of segments) {
    if (seg === "." || seg === "..") throw new Error(`capture store: key segment ${JSON.stringify(seg)} escapes the store in ${JSON.stringify(key)}`);
    if (!KEY_SEGMENT.test(seg)) throw new Error(`capture store: key segment ${JSON.stringify(seg)} is not [A-Za-z0-9][A-Za-z0-9._=-]* in ${JSON.stringify(key)}`);
  }
  const abs = path.resolve(root, ...segments);
  // Second line, per the note above. `root + sep` and not `startsWith(root)`:
  // a sibling directory named `captures-old` starts with `captures`.
  if (abs !== path.resolve(root) && !abs.startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`capture store: key ${JSON.stringify(key)} resolves outside the store root`);
  }
  return abs;
}

/**
 * Every file under `dir`, as `/`-joined paths relative to it.
 *
 * `isRoot` splits two failures that used to be one, and the comment here used to
 * claim the behaviour the code did not have: it said "one directory that cannot
 * be read costs those keys and nothing else" while actually rethrowing, which
 * aborted the whole listing.
 *
 * ROOT unreadable, and not merely absent, is a real fault and propagates. A
 * permission error on the store root means the caller is pointed somewhere it
 * cannot use, and answering "[]" would report an empty store — which the collector
 * would read as "nothing collected yet" and re-collect everything into a
 * directory it also cannot write.
 *
 * A NESTED directory that cannot be read costs its own keys and nothing else.
 * `listCaptures` exists to work out what is NOT collected yet, so returning fewer
 * keys fails toward "collect it again", which write-once makes free — whereas
 * throwing takes down the expiry report over one bad directory.
 */
function walk(dir, prefix, out, isRoot = false) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // A store that does not exist yet is the normal first-run case at any depth.
    if (e && e.code === "ENOENT") return out;
    if (isRoot) throw e;
    return out;
  }
  for (const e of entries) {
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/**
 * The store. THREE methods, and the narrowness is the point: PR 3 (the loader)
 * extends this surface rather than replacing a pile of direct writes, and the S3
 * implementation has three functions to satisfy rather than a call graph to
 * trace.
 *
 * - `hasCapture(key)` → boolean. Does this exact key exist?
 * - `putCapture(key, bytes)` → `"written" | "present"`. Write-once; an existing
 *   key is a SUCCESS, not an error (S3 invariant C: `412` means already
 *   collected).
 * - `listCaptures()` → sorted keys. What is already in the store.
 */
export function createCaptureStore(root) {
  const base = requireRoot(root);

  function hasCapture(key) {
    return existsSync(resolveKey(base, key));
  }

  function putCapture(key, bytes) {
    // Validate BEFORE creating anything: an invalid key must not leave a stray
    // directory tree behind as evidence of a refusal.
    const abs = resolveKey(base, key);
    if (typeof bytes !== "string" && !Buffer.isBuffer(bytes)) {
      throw new Error(`capture store: contents for ${JSON.stringify(key)} must be a string or Buffer, got ${typeof bytes}`);
    }
    // The write-once check. It is a STATUS check and not a lock — see the header:
    // the race it does not close is one where both writers hold the same bytes.
    if (existsSync(abs)) return "present";
    mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}${PART_MARK}${process.pid}`;
    // A `.part-<our own pid>` already on disk is DEBRIS, not a competitor. Only
    // one live process holds a given pid, so anything sitting at this exact path
    // was left by an earlier run whose pid the OS has since recycled — pid reuse
    // is ordinary, not exotic. Without this the `wx` open below returns EEXIST and
    // the write fails; the old code then removed the file and rethrew, so the key
    // was unwritable for that whole run and only recovered on the next one.
    // Clearing it first turns a wasted run into no wasted run, and it is provably
    // safe in a way a general "retry on EEXIST" would not be: the pid in the name
    // is ours.
    rmSync(tmp, { force: true });
    try {
      writeFileSync(tmp, bytes, { flag: "wx" });
      renameSync(tmp, abs);
      return "written";
    } catch (e) {
      try {
        rmSync(tmp, { force: true });
      } catch {
        // Best effort. The throw below is the news; a stray `.part-` file is not,
        // and it can never be mistaken for a capture — `listCaptures` filters
        // anything containing `PART_MARK`, and no key ends that way.
      }
      throw e;
    }
  }

  function listCaptures() {
    // `.part-<pid>` leftovers are EXCLUDED, and this is not tidiness. The expiry
    // warning derives "which runs are collected" from these keys, so a temp file
    // abandoned by a crashed write would report its run as collected when the
    // real key was never renamed into place — a capture that looks collected and
    // is not, which is the exact failure this subsystem keeps producing.
    return walk(base, "", [], true).filter((k) => !k.includes(PART_MARK)).sort();
  }

  // Three, and no `getCapture`. The collector never reads a capture back and
  // PR 3's loader does not exist yet, so a fourth method would be an untested
  // surface written on speculation — and the tests below read the file directly
  // to prove `putCapture` wrote the bytes it was given, which is what a fourth
  // method would have been used for anyway.
  return { hasCapture, putCapture, listCaptures };
}
