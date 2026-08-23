// Write the outcome back where the report came from.
//
// **WITHOUT THIS THE HABIT DOES NOT FORM.** A person who reports three things and
// never learns what happened to them stops reporting, and every cap and every
// adjustment this pipeline applies would be invisible — including the ones that
// changed the shape they approved. So the round trip is not a nicety: it is the
// half that makes the next batch happen.
//
// It writes `outcome.json` next to the bundle and prints the same summary. The
// panel reads that file to show `sent 8 · proposed 2 PRs → actual 3 (reason) ·
// issue 2 · thin 1`.
//
// Usage:
//   node report-back.mjs --source .wb-reports/<session> --plan plan.json \
//     [--assembly assembly.json] [--verified verified.json]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The outcome record.
 *
 * Every number the reporter was shown at handover has its counterpart here, so
 * the two can be compared without interpretation: what was sent, what it became,
 * and — where they differ — why.
 */
export function buildOutcome({ plan, assembly = null, verified = null, now = () => Date.now() }) {
  const byDestination = (name) =>
    plan.items.filter((item) => item.route.destination === name).length;

  const verifiedById = new Map((verified?.outcomes ?? []).map((o) => [o.itemId, o]));

  // A LANE THAT WAS SCHEDULED AND NEVER RECORDED IS NOT A PASS. `verified.json`
  // is written by `report-verify.mjs` with `outcomes: []` and filled in by
  // whoever runs the lanes, so an empty list is ambiguous between "nothing
  // failed" and "nobody ran it" — and reading it as the former told the reporter
  // their unverified report shipped as a clean PR.
  const pendingVerification = (verified?.checks ?? [])
    .filter((check) => check.lane !== "none" && !verifiedById.has(check.itemId))
    .map((check) => ({ itemId: check.itemId, lane: check.lane }));
  const lowered = plan.items
    .filter((item) => verifiedById.get(item.id)?.verified === false)
    .map((item) => ({
      itemId: item.id,
      note: item.note,
      // A failed verification does not delete the report; it files both sides.
      // Recorded here so the panel can say so rather than showing a silent
      // downgrade.
      became: "issue",
      reason: verifiedById.get(item.id).note,
    }));

  return {
    sessionId: plan.sessionId,
    at: now(),
    sent: plan.items.length,
    proposedPrs: (plan.groups ?? []).length,
    actualPrs: assembly?.prs?.length ?? 0,
    queuedPrs: assembly?.queued?.length ?? 0,
    issues: byDestination("thin") + lowered.length,
    duplicates: byDestination("duplicate"),
    lowered,
    pendingVerification,
    deltas: assembly?.deltas ?? [],
    missingCaptures: plan.missingCaptures ?? [],
    prs: (assembly?.prs ?? []).map((pr) => ({
      id: pr.id,
      branch: pr.branch,
      title: pr.title,
      itemIds: pr.itemIds,
      kind: pr.kind,
      lens: pr.lens ?? null,
    })),
  };
}

/** The line the panel shows. Short enough to read, complete enough to trust. */
export function renderOutcome(outcome) {
  const parts = [`sent ${outcome.sent}`];
  if (outcome.proposedPrs !== outcome.actualPrs) {
    parts.push(`proposed ${outcome.proposedPrs} PR(s) → actual ${outcome.actualPrs}`);
  } else {
    parts.push(`${outcome.actualPrs} PR(s)`);
  }
  if (outcome.issues > 0) parts.push(`${outcome.issues} issue(s)`);
  if (outcome.duplicates > 0) parts.push(`${outcome.duplicates} comment(s)`);
  if (outcome.queuedPrs > 0) parts.push(`${outcome.queuedPrs} queued`);

  const lines = [parts.join(" · ")];
  // Every adjustment, with its reason. A delta list the reporter has to ask for
  // is a delta list nobody reads.
  for (const delta of outcome.deltas) lines.push(`  - ${delta.reason}`);
  for (const item of outcome.lowered) lines.push(`  - “${item.note}” → ${item.reason}`);
  for (const pending of outcome.pendingVerification ?? []) {
    lines.push(`  - ${pending.itemId}: ${pending.lane} was scheduled but no result was recorded`);
  }
  for (const missing of outcome.missingCaptures) {
    lines.push(`  - “${missing.note}” travelled without its image`);
  }
  return lines.join("\n");
}

function argOf(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function readJson(file) {
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function main(argv) {
  const source = argOf(argv, "--source");
  const planFile = argOf(argv, "--plan");
  if (!source || !planFile) {
    process.stderr.write(
      "usage: report-back.mjs --source <dir> --plan <file> [--assembly <file>] [--verified <file>]\n",
    );
    process.exit(2);
  }
  const plan = readJson(planFile);
  if (!plan) {
    process.stderr.write(`could not read the plan at ${planFile}\n`);
    process.exit(1);
  }
  const outcome = buildOutcome({
    plan,
    assembly: readJson(argOf(argv, "--assembly")),
    verified: readJson(argOf(argv, "--verified")),
  });
  writeFileSync(path.join(source, "outcome.json"), `${JSON.stringify(outcome, null, 2)}\n`);
  process.stdout.write(`${renderOutcome(outcome)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
