// The TRUSTED probe executor — runs model-proposed argv, and nothing else.
//
// The hunter has no `Bash` (ask.mjs refuses it outright). It returns argv ARRAYS
// plus a prediction; this module executes them. Three properties follow, and they
// are the reason the pipeline is shaped this way:
//
//   1. No shell string is ever built from model output. `spawnSync` with an argv
//      array never invokes a shell, so `; rm -rf /` is an argument, not a command.
//      `renderReproSh` exists only to SHOW a human what ran, and is quote-tested.
//   2. The clean room is enforceable, because trusted code owns env, cwd and
//      timeouts rather than asking a model to respect them.
//   3. Replay is exact and free: re-running the same argv IS the replay. The
//      "the repro script doesn't match what the agent actually did" failure class
//      cannot occur, because there is no separately-authored repro.
//
// NOTE ON FAILURE DIRECTION — it is deliberately opposite to hunt-gate.mjs.
// The gate fails QUIET (uncertainty drops a candidate; the cost of a false report
// is maintainer attention). Safety here fails CLOSED (uncertainty REFUSES to run;
// the cost of a wrong execution is a deleted document). Two different axes:
// "should we report this?" vs "may we run this at all?". Do not unify them.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, statSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// --- secret redaction -------------------------------------------------------

/**
 * Strip credentials from anything that might be shown, logged or published.
 *
 * This is the highest-severity risk in the pipeline: probe output can contain
 * `Authorization: Bearer …` (a `--verbose` run echoes request headers), and the
 * eventual destination is a report in a PUBLIC repository. Applied at every
 * output boundary — the report renderer AND the on-disk artifact dump — because
 * a redaction that only guards the published path leaks through the debug path.
 *
 * `extra` carries the run's own live values (the API key), which is what catches
 * a token that does not match any generic shape.
 */
export function redactSecrets(text, { extra = [] } = {}) {
  let s = typeof text === "string" ? text : String(text ?? "");
  for (const v of extra) {
    if (typeof v === "string" && v.length >= 8) s = s.split(v).join("<REDACTED>");
  }
  return s
    .replace(/\bwfb_[A-Za-z0-9_-]+/g, "<REDACTED_API_KEY>")
    // JWTs before the generic Bearer rule, so a bearer-carried JWT is labelled
    // as a JWT rather than swallowed by the broader pattern.
    .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, "<REDACTED_JWT>")
    .replace(/\b(Bearer|Authorization:\s*Bearer)\s+\S+/gi, "$1 <REDACTED>")
    .replace(/\b(x-api-key|api[-_]?key|token|secret|password)(["'\s:=]+)([^\s"',}]{8,})/gi, "$1$2<REDACTED>");
}

// --- shell rendering (display only) -----------------------------------------

/** POSIX single-quote a token so it is inert no matter what it contains. */
function shQuote(token) {
  const s = String(token ?? "");
  // Only [A-Za-z0-9_./=:-] is safe bare; everything else gets single-quoted, and
  // an embedded single quote is closed, escaped, reopened ('\'').
  if (/^[A-Za-z0-9_.\/=:@-]+$/.test(s)) return s;
  return `'${s.split("'").join(`'\\''`)}'`;
}

/**
 * Render a human-readable reproduction script from the argv that ACTUALLY ran.
 *
 * Display only — nothing in this pipeline executes the output. It exists so a
 * maintainer reading a report can copy the steps. Because it is rendered from the
 * recorded argv rather than authored by a model, it cannot drift from what ran.
 * Every token is quoted; the tests assert that shell metacharacters, `$(…)`,
 * backticks, newlines and quotes all survive as literals.
 */
export function renderReproSh(probes, { bin = "wafflebase", extra = [] } = {}) {
  const lines = [
    "#!/bin/sh",
    "# Generated from the recorded argv — NOT executed by the hunt pipeline.",
    "# Every argument is single-quoted; nothing here is interpreted as a command.",
    "set -eu",
    "",
  ];
  for (const [i, p] of (Array.isArray(probes) ? probes : []).entries()) {
    const argv = Array.isArray(p?.argv) ? p.argv : [];
    if (p?.note) lines.push(`# ${redactSecrets(String(p.note), { extra }).replace(/\n/g, " ")}`);
    lines.push(`# probe ${i}`);
    lines.push([shQuote(bin), ...argv.map(shQuote)].join(" "));
    lines.push("");
  }
  return redactSecrets(lines.join("\n"), { extra });
}

// --- the clean room ---------------------------------------------------------

/**
 * Build the probe environment. REPLACES the ambient environment; never extends it.
 *
 * This is the load-bearing line in the module. Spreading `process.env` would let
 * the developer's real `~/.wafflebase/session.json` and default workspace leak in,
 * which means the "clean room" would be a lie and a mutating probe could act on
 * REAL documents. `WAFFLEBASE_CONFIG` and `WAFFLEBASE_SESSION` are honored by the
 * CLI (config.ts / session.ts), so pointing them into the scratch dir is enough
 * to isolate credentials without touching the CLI.
 *
 * `TZ`/`LANG`/`LC_ALL`/`NO_COLOR` are pinned because they are the cheapest
 * determinism win available: unpinned, a locale-formatted date or an ANSI colour
 * code differs between runs and every candidate looks non-deterministic, which
 * the replay gate would then discard as a phantom.
 */
export function buildProbeEnv(scratch, cfg = {}) {
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: scratch,
    TMPDIR: scratch,
    WAFFLEBASE_CONFIG: path.join(scratch, "config.yaml"),
    WAFFLEBASE_SESSION: path.join(scratch, "session.json"),
    TZ: "UTC",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    CI: "1",
  };
  // Only set when supplied — an undefined value would become the string
  // "undefined" and the CLI would treat it as a real (broken) setting.
  if (cfg.server) env.WAFFLEBASE_SERVER = cfg.server;
  if (cfg.workspace) env.WAFFLEBASE_WORKSPACE = cfg.workspace;
  if (cfg.apiKey) env.WAFFLEBASE_API_KEY = cfg.apiKey;
  return env;
}

/**
 * Locate the built CLI, failing closed if it is missing or stale.
 *
 * Probes run the BUILT bundle (`dist/bin.js`) via a bare `node` spawn, never
 * `pnpm cli dev --`: pnpm injects its own exit code and stderr, so a probe would
 * be observing pnpm rather than the CLI and the pipeline would file bugs against
 * the package manager.
 *
 * Staleness is fatal rather than a warning. A stale bundle means every
 * observation describes code that is no longer in the tree, so the citations a
 * candidate carries would point at source the probe never executed — findings
 * that look grounded and are not.
 */
export function resolveCliBin(repoRoot, { now = null } = {}) {
  const bin = path.join(repoRoot, "packages", "cli", "dist", "bin.js");
  if (!existsSync(bin)) {
    throw new Error(`hunt-probe: ${bin} not found — run \`pnpm cli build\` first (refusing to probe an unbuilt CLI).`);
  }
  const binMtime = statSync(bin).mtimeMs;
  const srcDir = path.join(repoRoot, "packages", "cli", "src");
  const newestSrc = existsSync(srcDir) ? newestMtime(srcDir) : 0;
  if (newestSrc > binMtime) {
    throw new Error(
      "hunt-probe: packages/cli/dist/bin.js is OLDER than packages/cli/src — " +
        "run `pnpm cli build`. Probing a stale bundle would produce observations " +
        "about code that is not in the tree.",
    );
  }
  return { bin, binMtime, newestSrc, checkedAt: now };
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

// --- argv safety ------------------------------------------------------------

/**
 * Commands refused outright for EVERY charter, mutating or not, independent of
 * any schema.
 *
 * A floor, not the whole rule, and the reason is specific: the CLI's own
 * `src/schema/registry.ts` is hand-maintained with no drift guard against
 * commander — and its wrongness is one of the things this pipeline HUNTS (it
 * annotates `docs.export`/`sheets.export` as `read-only` while they write files).
 * A guard that trusted the schema alone would be trusting a known-unreliable
 * source about whether it is safe to destroy something.
 */
export const HARD_DENIED_COMMANDS = Object.freeze([
  ["api-keys"], // create / revoke — credential lifecycle, never in a probe
  ["api-key"],
  ["login"], // opens a browser + writes real session state
  ["logout"], // clears the developer's real session
  ["ctx", "switch"], // rewrites the active workspace in the session file
]);

/**
 * Does `needle` appear as a contiguous run anywhere in `words`?
 *
 * Deliberately over-inclusive: a document literally titled "logout" would make
 * `docs create logout` look denied. That is the correct failure direction for a
 * SAFETY check — over-refusing costs one skipped probe, under-refusing can revoke
 * a credential. No charter, mutating or not, is exempt: these commands are never
 * part of a charter's job, so there is no `mutating: true` escape hatch.
 */
function containsSequence(words, needle) {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= words.length; i++) {
    if (needle.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

/**
 * May this argv be executed under this charter?
 *
 * Fails CLOSED: an argv whose safety cannot be established is refused. Note this
 * is the opposite direction from hunt-gate.mjs, and correctly so — see the header.
 *
 * `safetyOf` maps an argv to the CLI's declared level
 * (`read-only | write | destructive`) when the caller has the schema; an unknown
 * command under a non-mutating charter is refused rather than assumed safe.
 */
export function assertSafeArgv(argv, { mutating = false, safetyOf = null } = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === "string")) {
    throw new Error(`hunt-probe: malformed argv ${JSON.stringify(argv)}`);
  }
  // Flags are irrelevant to which command is invoked, but note this list still
  // contains flag VALUES (`--format json` leaves `json`), so the command words are
  // not reliably at a fixed offset. Matching is therefore CONTIGUOUS-ANYWHERE
  // rather than anchored at position 0 — an anchored match let
  // `--format json api-keys revoke x` through, because `words[0]` was `json`.
  const words = argv.filter((a) => !a.startsWith("-"));
  // Hard denials are UNCONDITIONAL — they hold for mutating charters too. A
  // mutating charter is licensed to create/rename/delete DOCUMENTS in the vetted
  // hunt workspace; it is never licensed to touch credentials or the session. In
  // particular `ctx switch` rewrites the active workspace and would move probes
  // OFF the hunt workspace the refusal in hunt-workspace.mjs worked to isolate,
  // and `login`/`logout`/`api-keys` act on the developer's real session. None of
  // those is part of any charter's job, so `mutating` must not relax them.
  for (const denied of HARD_DENIED_COMMANDS) {
    if (containsSequence(words, denied)) {
      throw new Error(
        `hunt-probe: refusing \`${denied.join(" ")}\` — credential and session commands are ` +
          `hard-denied for every charter, mutating or not.`,
      );
    }
  }
  // The schema-level destructive/write verdict is the ONE check a mutating charter
  // relaxes: mutating the hunt workspace is exactly what it is here to do.
  if (!mutating && typeof safetyOf === "function") {
    const level = safetyOf(words);
    if (level === "destructive" || level === "write") {
      throw new Error(`hunt-probe: refusing \`${words.join(" ")}\` (declared ${level}) under a non-mutating charter.`);
    }
    if (level == null) {
      throw new Error(
        `hunt-probe: \`${words.join(" ")}\` has no declared safety level — refusing under a ` +
          `non-mutating charter (fail closed: an unknown command is not assumed read-only).`,
      );
    }
  }
  return true;
}

// --- running ----------------------------------------------------------------

export const DEFAULT_PROBE_TIMEOUT_MS = 20_000;
const MAX_BUFFER = 4 << 20; // 4 MiB — enough for a stack trace, bounded

/**
 * Run one probe and record what happened. Never throws for a failing probe: a
 * non-zero exit IS the observation, and for the `crash` oracle it is the point.
 *
 * `runner` is injectable so the tests can exercise sequencing, replay and
 * determinism without spawning a CLI.
 */
export function runProbe(probe, { bin, env, cwd, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, runner = null } = {}) {
  const argv = Array.isArray(probe?.argv) ? probe.argv : [];
  if (typeof runner === "function") return runner(argv, { bin, env, cwd, timeoutMs });

  // Materialize any fixture files the probe needs, inside the scratch only.
  for (const f of Array.isArray(probe?.files) ? probe.files : []) {
    const dest = path.resolve(cwd, f.path);
    // Refuse a path that escapes the scratch — `../` in a model-supplied path is
    // the obvious way to write outside the clean room.
    if (!dest.startsWith(path.resolve(cwd) + path.sep)) {
      throw new Error(`hunt-probe: fixture path escapes the scratch dir: ${f.path}`);
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(String(f.contentBase64 ?? ""), "base64"));
  }

  // spawnSync, NOT execFileSync: it returns a failing status instead of throwing,
  // so a non-zero exit is data rather than control flow. shell is left off (the
  // default) — passing `shell: true` here would undo the whole design.
  const res = spawnSync(process.execPath, [bin, ...argv], {
    env,
    cwd,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: MAX_BUFFER,
    encoding: "utf8",
    input: typeof probe?.stdin === "string" ? probe.stdin : undefined,
  });

  const timedOut = res.error?.code === "ETIMEDOUT" || (res.status === null && res.signal === "SIGKILL");
  return {
    argv,
    exitCode: res.status,
    signal: res.signal ?? null,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    timedOut,
    spawnError: res.error && !timedOut ? String(res.error.message) : null,
  };
}

/** Run a probe sequence in order, returning every observation. */
export function runSequence(probes, opts) {
  return (Array.isArray(probes) ? probes : []).map((p) => runProbe(p, opts));
}

/**
 * Do two observations describe the same outcome?
 *
 * Compares the SHAPE — exit code, timeout, which stream carried output, and
 * whether output was JSON/stack/text — not message text. Text embeds ids, paths
 * and timings, so comparing it would make every replay look divergent and the
 * gate would discard every real finding as non-deterministic.
 *
 * Delegates to `observedKey` in hunt-fingerprint.mjs so "same outcome" has ONE
 * definition shared with the fingerprint. If these two drifted, a candidate could
 * replay "identically" under one rule and be a different defect under the other.
 */
export function sameObservation(a, b, observedKey) {
  return observedKey(a) === observedKey(b);
}

/**
 * Replay a candidate's whole probe sequence, N times, in a FRESH scratch each
 * time, and decide whether it reproduces deterministically.
 *
 * Three deliberate choices:
 *   - The ENTIRE sequence is replayed, not just the failing probe. If a candidate
 *     only reproduces because an earlier probe left state behind, that is either
 *     a real `state` defect (and the setup belongs in the repro) or an artifact.
 *     Replaying only the failing probe would silently accept both.
 *   - A fresh scratch per attempt, so attempt 2 cannot inherit attempt 1's files.
 *   - N attempts (default 3) must agree. Timestamps, generated ids and map
 *     ordering are the top source of phantom repros, and they are cheap to
 *     detect this way — before any model is asked to verify anything.
 *
 * Returns `{ status, deterministic, attempts, divergedAt }`.
 * `status` is `"reproduced"` only when every attempt matched the CLAIMED
 * observation. Anything else — divergence between attempts, or agreement on
 * something other than the claim — is not a reproduction.
 */
export function replay(probes, claimedObserved, { attempts = 3, observedKey, runAttempt } = {}) {
  if (typeof observedKey !== "function" || typeof runAttempt !== "function") {
    throw new Error("hunt-probe.replay: observedKey and runAttempt are required");
  }
  const claimedKey = observedKey(claimedObserved);
  const results = [];
  for (let i = 0; i < attempts; i++) {
    const observations = runAttempt(probes, i);
    // An attempt that produced NO observation (empty probe sequence, or a
    // runAttempt that returned []) never ran anything, so it cannot be a
    // reproduction. Fail CLOSED: without this, `observedKey(undefined)`
    // yields the empty-shape key, every empty attempt "agrees", and a claim
    // that is also empty-shaped (exitCode:null, no output) replays as
    // `reproduced` without a single probe having executed. See the header:
    // safety here fails closed, and so must this.
    const ran = Array.isArray(observations) && observations.length > 0;
    const failing = ran ? observations[observations.length - 1] : undefined;
    results.push({ attempt: i, key: ran ? observedKey(failing) : null, observation: failing, ran });
  }
  const anyEmpty = results.some((r) => !r.ran);
  const first = results[0]?.key ?? null;
  const divergedAt = results.findIndex((r) => r.key !== first);
  const deterministic = !anyEmpty && divergedAt === -1;
  const status = anyEmpty
    ? "not-reproduced"
    : !deterministic
      ? "non-deterministic"
      : first === claimedKey
        ? "reproduced"
        : "not-reproduced";
  return {
    status,
    deterministic,
    claimedKey,
    observedKey: first,
    attempts: results.map((r) => ({ attempt: r.attempt, key: r.key })),
    divergedAt: divergedAt === -1 ? null : divergedAt,
  };
}

/** Make a scratch dir and hand it to `fn`, removing it afterwards regardless. */
export function withScratch(fn, { prefix = "wb-hunt-" } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
