// Candidate fingerprinting + the novelty ledger.
//
// Exploration is unbounded, unlike review (which is bounded by a diff). Without a
// memory, every run re-proposes what the last run already rejected, and the same
// candidate is re-verified — and possibly re-reported — forever. The ledger is
// that memory.
//
// The fingerprint is computed from what TRUSTED CODE owns: the probe argv and the
// observed OUTCOME SHAPE. Never from the model's prose. LLM phrasing varies run to
// run, so a prose fingerprint never matches itself twice and the ledger would
// never converge — the failure this module exists to prevent.
//
// Everything here is pure and synchronous: no Date.now(), no Math.random(), no
// filesystem. Two runs over the same inputs must produce the same fingerprints.

import { createHash } from "node:crypto";

// Written as escapes, not literal control characters: the literals render as
// invisible (or as whitespace) in most diff views, which makes the separator
// impossible to review and easy for an editor to silently mangle. Both are
// unrepresentable in a real argv or file path, so neither can collide with data.
const UNIT = "\u001f"; // between argv elements
const NUL = "\u0000"; // between fingerprint fields

/**
 * Replace the parts of an argv that legitimately differ between two runs of the
 * SAME defect. Order matters: broader patterns run after narrower ones so a
 * seeded name is not first eaten by the hex rule.
 *
 * Without this, a probe that creates `hunt-<runId>-1` and one that creates
 * `hunt-<runId>-2` fingerprint differently and the ledger treats the second run's
 * rediscovery as novel — re-reporting the same defect every night.
 */
export function scrubVolatile(argv) {
  return (Array.isArray(argv) ? argv : []).map((raw) => {
    let s = String(raw ?? "");
    // Seeded fixture names this pipeline creates itself.
    s = s.replace(/hunt-[0-9a-z]+-\d+/gi, "<SEED>");
    // UUIDs (document ids, workspace ids).
    s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>");
    // ISO-8601 timestamps.
    s = s.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<TS>");
    // Per-run scratch directories: macOS (/var/folders/...), Linux (/tmp/...).
    s = s.replace(/\/(?:private\/)?var\/folders\/[^\s]*/g, "<TMP>");
    s = s.replace(/\/tmp\/[^\s]*/g, "<TMP>");
    // Ephemeral ports.
    s = s.replace(/:\d{4,5}\b/g, ":<PORT>");
    // Long hex runs (tokens, hashes) — last, so the rules above win.
    s = s.replace(/\b[0-9a-f]{16,}\b/gi, "<HEX>");
    return s;
  });
}

/**
 * The SHAPE of what a probe did — never its message text.
 *
 * Message strings embed paths, ids and counts, so keying on them would make every
 * run look novel. The shape is what actually distinguishes one defect from
 * another: which exit code, which stream carried output, which structured error
 * code, and what KIND of output it was.
 *
 * `err` reads the CLI's documented JSON error envelope (`{"error":{"code",...}}`)
 * when present, because a stable machine code is exactly the right granularity.
 */
export function observedKey(obs) {
  const o = obs && typeof obs === "object" ? obs : {};
  if (o.timedOut === true) return "exit:timeout|to:0|err:none|kind:empty";
  const exit = Number.isInteger(o.exitCode) ? o.exitCode : "null";
  const stdout = typeof o.stdout === "string" ? o.stdout : "";
  const stderr = typeof o.stderr === "string" ? o.stderr : "";
  // Which stream carried the payload. `to:1` = something on stdout.
  const to = stdout.trim() === "" ? 0 : 1;
  return `exit:${exit}|to:${to}|err:${errorCode(stdout, stderr)}|kind:${outputKind(stdout, stderr)}`;
}

/** The `error.code` from the CLI's JSON envelope on either stream, else "none". */
function errorCode(stdout, stderr) {
  for (const text of [stderr, stdout]) {
    const t = text.trim();
    if (t === "" || !t.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(t);
      const code = parsed?.error?.code;
      if (typeof code === "string" && code !== "") return code;
    } catch {
      // Not JSON — fall through to the next stream. A parse failure is itself
      // captured by `outputKind` below, which is where "claimed JSON, wasn't"
      // becomes visible.
    }
  }
  return "none";
}

/**
 * Classify output into one of four kinds. This is what makes "the CLI printed a
 * raw stack trace" a distinct, fingerprintable observation from "the CLI printed
 * a clean JSON envelope" — the core `crash` and `contract` oracles.
 */
function outputKind(stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  if (combined.trim() === "") return "empty";
  // A Node stack trace: "    at fn (file:1:2)" or a bare "Error: ..." header.
  if (/^\s+at\s+.+:\d+:\d+\)?$/m.test(combined) || /\b[A-Za-z]*Error:\s/.test(combined)) return "stack";
  const t = (stderr.trim() || stdout.trim());
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      return "text"; // claimed to be JSON but is not — a real, distinct outcome
    }
  }
  return "text";
}

/**
 * The stable identity of a candidate: charter + scrubbed probe + oracle +
 * observed shape.
 *
 * The FAILING probe is what identifies the defect; earlier probes are setup and
 * two candidates that differ only in how they set up are the same finding.
 */
export function fingerprint({ charterId, argv, oracle, observed }) {
  const parts = [
    String(charterId ?? ""),
    scrubVolatile(argv).join(UNIT),
    String(oracle ?? ""),
    observedKey(observed),
  ];
  return createHash("sha256").update(parts.join(NUL)).digest("hex").slice(0, 32);
}

/**
 * The identity of the DEFECT a candidate describes — used to ask whether two
 * independent samples found the same thing.
 *
 * This is deliberately NOT `fingerprint()`. That one hashes the probe argv, which
 * is the right identity for the ledger (where the argv has actually been run and
 * the observation is real), and the WRONG identity for cross-sample agreement:
 * two samples that find the same defect routinely reach it by different probes.
 * The first live run showed this exactly — 9 candidates proposed across 2 samples,
 * 0 agreements, because agreement was being tested on byte-identical argv.
 *
 * A defect is identified instead by WHERE it is and WHAT KIND it is: the oracle
 * plus the code location the candidate blames. That is stable across two samples
 * describing the same bug in different words with different probes, and still
 * distinguishes two genuinely different bugs — including two in the same file,
 * because the line number participates.
 *
 * Still no model prose: a `file.ext:line` citation is a location, not phrasing.
 */
export function defectKey({ charterId, oracle, citations, docCitation }) {
  // First citation that actually locates a line wins — candidates list the
  // primary evidence first, and a bare filename cannot identify a defect.
  const located = (Array.isArray(citations) ? citations : [])
    .map((c) => (typeof c === "string" ? /[^\s:]+\.[A-Za-z0-9_]+:\d+/.exec(c)?.[0] : null))
    .filter(Boolean);
  const doc = typeof docCitation === "string" ? /[^\s:]+\.[A-Za-z0-9_]+:\d+/.exec(docCitation)?.[0] : null;
  // A candidate that locates nothing gets no defect key — it cannot be matched
  // against anything, and returning "" makes the caller drop it rather than
  // silently grouping every unlocatable candidate together under one key.
  if (located.length === 0 && !doc) return "";
  const parts = [String(charterId ?? ""), String(oracle ?? ""), located[0] ?? "", doc ?? ""];
  return createHash("sha256").update(parts.join(NUL)).digest("hex").slice(0, 32);
}

/**
 * A coarser "somewhere in this file, under this charter" key.
 *
 * Advisory ONLY — used to note in the report that a run touched the same file
 * twice. Never a drop criterion: one file routinely holds several distinct
 * defects, and dropping on this would hide all but the first.
 */
export function siteFingerprint(charterId, citation) {
  return createHash("sha256")
    .update(`${String(charterId ?? "")}${NUL}${String(citation ?? "")}`)
    .digest("hex")
    .slice(0, 16);
}

// --- the ledger -------------------------------------------------------------

/**
 * Parse the seen-ledger, reporting parse failures rather than swallowing them.
 *
 * This is the one place in the hunt pipeline where "fail quiet" is the WRONG
 * default, and it is worth being explicit about why. Everywhere else, losing
 * information means not reporting — safe. Here, losing information means the
 * ledger looks EMPTY, so every previously-rejected candidate becomes novel again
 * and gets re-reported. That is the noise this module exists to prevent, so a
 * corrupt ledger must be loud.
 *
 * Hence the return shape: `{ seen, parseErrors }`. The caller (hunt.mjs) ABORTS
 * the run when `parseErrors > 0`, rather than proceeding on a ledger it cannot
 * trust. Returning a bare array would make that impossible to detect.
 */
export function parseSeenLedger(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (raw === "") return { seen: [], parseErrors: 0 };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { seen: [], parseErrors: 1 };
  }
  if (!Array.isArray(data)) return { seen: [], parseErrors: 1 };
  const seen = [];
  let parseErrors = 0;
  for (const e of data) {
    if (e && typeof e === "object" && typeof e.fp === "string" && e.fp !== "") seen.push(e);
    else parseErrors++;
  }
  return { seen, parseErrors };
}

export function serializeSeenLedger(entries) {
  return `${JSON.stringify(Array.isArray(entries) ? entries : [], null, 2)}\n`;
}

/**
 * Is this fingerprint worth spending verification on?
 *
 * A pure blocklist would converge to proposing nothing: once a defect is
 * recorded, the hunter is permanently blind to it — including to a REGRESSION
 * that reintroduces it after a refactor. So an entry expires when the code it
 * concerns has changed.
 *
 * `changedSince(sha)` is injected (hunt.mjs supplies a `git log <sha>..HEAD --
 * <charter.codeScope>` check) to keep this module pure and testable. When it is
 * not supplied, entries never expire — the conservative direction, since the cost
 * is a missed rediscovery rather than a duplicate report.
 */
export function isNovel(fp, seen, { changedSince } = {}) {
  const entries = (Array.isArray(seen) ? seen : []).filter((e) => e && e.fp === fp);
  if (entries.length === 0) return true;
  if (typeof changedSince !== "function") return false;
  // Novel again only if the scope has moved since EVERY sighting: if any sighting
  // is newer than the last relevant change, we have already looked at this
  // defect in its current form.
  return entries.every((e) => typeof e.sha === "string" && e.sha !== "" && changedSince(e.sha) === true);
}
