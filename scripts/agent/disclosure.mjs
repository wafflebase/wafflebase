// Shared AI-authorship disclosure check — the SINGLE source of truth for the
// PR-body gate. Both the cloud ready-gate (`mark-ready.mjs`) and the local front
// door (`spec-to-pr.mjs`) import this, so the two can never drift apart.
//
// `scripts/hooks/require-ai-disclosure.sh` is a shell hook and keeps its own copy
// of the trailer string; DISCLOSURE_TRAILER here mirrors it.

/** The commit trailer autonomous runs must carry (see require-ai-disclosure.sh). */
export const DISCLOSURE_TRAILER = "Assisted-by: Claude Code (autonomous)";

/**
 * True iff a PR body discloses autonomous AI authorship. This IS the gate
 * `mark-ready.mjs` enforces before promoting a PR to ready — keep it here so the
 * local front door validates against the exact same predicate.
 */
export function disclosesAiAuthorship(body) {
  const b = String(body ?? "");
  return /autonomous/i.test(b) && /(claude|ai[- ]assist|ai tools)/i.test(b);
}

/** True iff a single commit message ENDS with the autonomous disclosure trailer.
 * The contract is that the trailer is terminal (a git trailer, last line); an
 * `includes()` check would also pass a message with the trailer buried mid-body
 * followed by arbitrary content, so require it at the end (ignoring trailing
 * whitespace). */
export function hasDisclosureTrailer(message) {
  return String(message ?? "").trimEnd().endsWith(DISCLOSURE_TRAILER);
}
