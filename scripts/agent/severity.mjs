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

/** Normalize a raw findings array into `[{severity,file,summary,evidence}]`. */
export function normalizeFindings(rawFindings) {
  const arr = Array.isArray(rawFindings) ? rawFindings : [];
  return arr.map((f) => ({
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
    .map((f) => `- ${f.file ? `\`${f.file}\` — ` : ""}${f.summary ?? "(no summary)"}`)
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
      const proof = n.alsoAt
        ? `\n  - already at \`${n.alsoAt.split(":").slice(0, 3).join(":")}\``
        : n.blameSha
          ? `\n  - written in \`${String(n.blameSha).slice(0, 9)}\`, which predates this branch`
          : "";
      return `- ${where}${f.summary ?? "(no summary)"}${proof}`;
    })
    .join("\n");
  return (
    `\n### Pre-existing — not introduced by this change (${rows.length}, not blocking)\n` +
    `_Confirmed real, but the code predates this branch, so it does not gate this PR._\n${body}\n`
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
export function renderSummaryMd(label, rawFindings, summaryText, { advisory = false, demoted = [] } = {}) {
  // Render from the NORMALIZED findings so an unknown severity (→ major) is
  // counted and shown as a blocking finding, not omitted or counted as zero.
  const { approved, blockingCount, findings } = classify(rawFindings);
  const header = advisory
    ? `ℹ️ ${label}: **advisory — not gating** — ${blockingCount} critical/major, informational only (${countsStr(findings)}).`
    : approved
      ? `✅ ${label}: **approved** — no critical or major findings (${countsStr(findings)}).`
      : `❌ ${label}: **changes requested** — ${blockingCount} blocking (critical/major) finding(s) (${countsStr(findings)}).`;
  return (
    `${header}\n\n${summaryText ?? ""}` +
    section(findings, "critical", "Critical") +
    section(findings, "major", "Major") +
    section(findings, "minor", "Minor (non-blocking)") +
    section(findings, "nit", "Nit (non-blocking)") +
    demotedSection(demoted)
  );
}
