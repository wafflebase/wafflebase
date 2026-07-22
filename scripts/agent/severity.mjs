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
 * Render the Markdown check-run body for a set of findings.
 * `advisory: true` marks a NON-GATING lens: its check always reports success, so
 * the body must not claim "changes requested" even when it raised a blocking
 * finding — otherwise a green check would open with a ❌ that contradicts it.
 */
export function renderSummaryMd(label, rawFindings, summaryText, { advisory = false } = {}) {
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
    section(findings, "nit", "Nit (non-blocking)")
  );
}
