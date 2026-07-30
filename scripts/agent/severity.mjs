// Shared severity rule for the agent reviewers — ONE source of truth for
// "what blocks a PR". Used by both the standalone verdict reader
// (read-review-verdict.mjs) and the panel orchestrator (review-panel.mjs), so
// the gate can never drift between them.
//
// Scale: critical | major | minor | nit
//   - critical / major → BLOCKING (changes requested)
//   - minor / nit       → non-blocking (informational)
// A verdict is APPROVED iff it has zero critical/major findings.
// Any unrecognized severity is treated as `major` (fail-safe).

export const KNOWN = ["critical", "major", "minor", "nit"];
export const BLOCKING = new Set(["critical", "major"]);

/** Normalize an arbitrary severity string; unknown → "major" (fail-safe). */
export function normalizeSeverity(raw) {
  const s = String(raw ?? "").toLowerCase().trim();
  return KNOWN.includes(s) ? s : "major";
}

/**
 * Normalize a raw findings array: `severity` coerced to the known scale, every
 * other field PRESERVED.
 *
 * It used to rebuild each finding as exactly `{severity,file,summary,evidence}`,
 * which silently dropped everything the orchestrator annotates onto a finding
 * after the lens produced it. That was a real bug rather than a tidy contract:
 * `renderSummaryMd` renders from `classify()`'s output, so the
 * "verifier could not settle this" marker added for unresolved verifications
 * never appeared in a single check body — the field was gone by the time the
 * renderer looked for it. Anything that reads a finding downstream of `classify`
 * needs the whole finding, so the safe shape is additive.
 */
export function normalizeFindings(rawFindings) {
  const arr = Array.isArray(rawFindings) ? rawFindings : [];
  return arr.map((f) => ({
    ...(f && typeof f === "object" ? f : {}),
    severity: normalizeSeverity(f?.severity),
    file: f?.file,
    summary: f?.summary,
    evidence: f?.evidence,
  }));
}

/**
 * Decide the check-run conclusion from findings (already normalized or not).
 * Returns { conclusion, approved, blockingCount, findings }.
 */
export function classify(rawFindings) {
  const findings = normalizeFindings(rawFindings);
  const blockingCount = findings.filter((f) => BLOCKING.has(f.severity)).length;
  const approved = blockingCount === 0;
  return { conclusion: approved ? "success" : "failure", approved, blockingCount, findings };
}

/** "1 critical, 0 major, 2 minor, 3 nit" */
export function countsStr(findings) {
  return KNOWN.map((s) => `${findings.filter((f) => f.severity === s).length} ${s}`).join(", ");
}

function section(findings, severity, heading) {
  const rows = findings.filter((f) => f.severity === severity);
  if (rows.length === 0) return "";
  const body = rows
    .map((f) => {
      // An `unsettled` finding blocks exactly like any other — the marker is for
      // the human deciding how much to trust it. It means the verifier searched
      // and could not disprove the claim, which is NOT the same as having
      // confirmed it, and printing them identically would read as endorsement.
      const unsettled = f.unsettled ? " _(verifier could not settle this)_" : "";
      // Other wordings of this same defect, folded in by the clustering pass.
      // Printed rather than dropped: merging is a judgement, and a reader — or
      // the fix agent — must be able to see what was merged and disagree. A
      // collapse nobody can inspect is a silent deletion with extra steps.
      const merged = Array.isArray(f.mergedFrom) && f.mergedFrom.length
        ? `\n  <details><summary>also reported as (${f.mergedFrom.length})</summary>\n\n` +
          f.mergedFrom.map((m) => `  - (${m.severity}) ${m.summary ?? "(no summary)"}`).join("\n") +
          "\n  </details>"
        : "";
      return `- ${f.file ? `\`${f.file}\` — ` : ""}${f.summary ?? "(no summary)"}${unsettled}${merged}`;
    })
    .join("\n");
  return `\n### ${heading} (${rows.length})\n${body}\n`;
}

/**
 * Findings the gate looked at and DEMOTED — real, but not caused by this change.
 *
 * Rendered apart from the severity sections and after them, because they are a
 * different kind of statement: the severity sections say "fix this before
 * merging", this one says "this is worth fixing, but not here, and here is the
 * proof it predates you". Each row carries that proof — the base location the
 * code already lives at, or failing that the commit that wrote it — so a reader
 * can check the demotion by eye instead of trusting it. A demotion nobody can
 * audit is just a silent drop with extra steps.
 *
 * This module is deliberately not lane-aware: the caller decides what was
 * demoted and passes it in, so the routing vocabulary stays in one place.
 */
function demotedSection(demoted) {
  const rows = Array.isArray(demoted) ? demoted.filter((f) => f && typeof f === "object") : [];
  if (rows.length === 0) return "";
  const body = rows
    .map((f) => {
      const where = f.file ? `\`${f.file}\` — ` : "";
      const n = f.novelty ?? {};
      // Only claim what a probe established. `alsoAt` is a location git matched;
      // `contentSha` is the commit move-aware blame named AND that was checked
      // against the base. Anything else prints no proof line rather than an
      // unbacked assertion — an audit line that can be false is worse than none,
      // because its whole job is to let a reader check the demotion.
      const proof = n.alsoAt
        ? `\n  - this line already exists at \`${n.alsoAt}\``
        : n.contentSha
          ? `\n  - content dates to \`${String(n.contentSha).slice(0, 9)}\`, which predates the base`
          : "";
      return `- ${where}${f.summary ?? "(no summary)"}${proof}`;
    })
    .join("\n");
  return (
    `\n### Relocated code — not written by this change (${rows.length}, not blocking)\n` +
    "_Confirmed real. This change moved these lines here; the code itself already " +
    "existed, so the defect is not this PR's to fix and does not gate it._\n" +
    `${body}\n`
  );
}

/**
 * Render the Markdown check-run body for a set of findings.
 * `advisory: true` marks a NON-GATING lens: its check always reports success, so
 * the body must not claim "changes requested" even when it raised a blocking
 * finding — otherwise a green check would open with a ❌ that contradicts it.
 *
 * `demoted` is the same idea one level down: those findings are excluded from
 * `rawFindings` by the caller, so the header counts what actually gates. Passing
 * them inside `rawFindings` instead would print "❌ 3 blocking" above a green
 * check — the exact contradiction `advisory` exists to prevent.
 */
export function renderSummaryMd(label, rawFindings, summaryText, { advisory = false, demoted = [], unverified = null } = {}) {
  // Render from the NORMALIZED findings so an unknown severity (→ major) is
  // counted and shown as a blocking finding, not omitted or counted as zero.
  const { approved, blockingCount, findings } = classify(rawFindings);
  const header = advisory
    ? `ℹ️ ${label}: **advisory — not gating** — ${blockingCount} critical/major, informational only (${countsStr(findings)}).`
    : approved
      ? `✅ ${label}: **approved** — no critical or major findings (${countsStr(findings)}).`
      : `❌ ${label}: **changes requested** — ${blockingCount} blocking (critical/major) finding(s) (${countsStr(findings)}).`;
  // Stated immediately under the header, before any finding, because it changes
  // how every finding below should be read. An outage makes the panel MORE
  // blocking (the error path keeps findings), so this is not a safety warning —
  // it is a trust one: without it, a wall of unfiltered findings is
  // indistinguishable from a wall of verified defects.
  const unverifiedNote = unverified && unverified.errored > 0
    ? `\n> ⚠️ **The verifier did not run on ${unverified.errored} of ${unverified.sent} blocking finding(s)**` +
      " — those sessions errored (commonly an API/session-limit 429), so those findings are" +
      " UNFILTERED rather than confirmed. Findings are kept when verification fails, which is" +
      " why this reads as a full review. Treat the unverified ones as unreviewed claims.\n"
    : "";
  return (
    `${header}\n${unverifiedNote}\n${summaryText ?? ""}` +
    section(findings, "critical", "Critical") +
    section(findings, "major", "Major") +
    section(findings, "minor", "Minor (non-blocking)") +
    section(findings, "nit", "Nit (non-blocking)") +
    demotedSection(demoted)
  );
}
