// Check a report before anything is filed for it — by delegating, in one of two
// directions, and never by inventing a third.
//
//   a report with STEPS      → synthesise a plan → `hunt-ui.mjs replay`
//   an APPEARANCE report     → the visual lane's before/after/diff images
//
// `hunt-ui` needs a prediction and a replayable plan. "The padding is too tight"
// has neither, and adding a "looks wrong" ground to satisfy it is exactly what
// `harness-engineering.md` Phase 31 refuses. So appearance reports skip replay —
// and do not skip review: the `visual-intent` lens judges them against the
// reporter's own sentence.
//
// **A FAILED VERIFICATION LOWERS THE DESTINATION. IT NEVER DELETES A REPORT.**
// Replay saying "not reproduced" is not proof the observation was wrong: the
// documented failure where a reader's scope is wider than the action is real. So
// the outcome is an issue carrying BOTH the expectation and the failed replay,
// leaving the discrepancy visible to a person instead of resolved by a machine.
//
// Nothing here runs a lane by itself. It emits the commands and consumes their
// results, so `--dry-run` prints exactly what a real run would do.
//
// Usage:
//   node report-verify.mjs --plan plan.json [--dry-run] [--out verified.json]

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the `visual-intent` rubric lives.
 *
 * Its own directory, not `lenses/lenses.json`: registered in the shared manifest
 * it applied to every PR touching `packages/frontend/**` and blocked each one
 * with a rubric that needs a reporter's sentence and diff images those PRs do
 * not have. `review-panel.mjs --lenses-dir` is the seam for this.
 *
 * A SIBLING of `lenses/`, not a subdirectory of it. Nested, it made
 * `readdirSync(lenses/)` return a directory, and `eval/run.test.mjs` — which
 * copies that directory file by file — died on EISDIR. `lenses/` is the review
 * panel's lens set; a report-only set inside it is a category error.
 */
export const LENSES_DIR = "scripts/agent/report-lenses";

/**
 * Turn a sentence into a replay plan, or say why it cannot be one.
 *
 * DELIBERATELY CONSERVATIVE. A plan this cannot build honestly is routed to the
 * appearance lane, which reviews the change against the reporter's words —
 * whereas a guessed plan would produce a replay that proves nothing and a verdict
 * that reads as if it did.
 */
export function synthesisePlan(item, { surface = null } = {}) {
  const note = String(item.note ?? "");
  const target = item.target ?? {};
  const address = target.address ?? null;
  const engine = surface ?? target.surface ?? null;

  if (!engine) {
    return {
      ok: false,
      reason:
        "the report does not name an engine surface, and `hunt-ui` replays against one — routed to the appearance lane",
    };
  }
  if (!address) {
    return {
      ok: false,
      reason:
        "the report has no semantic address, so a replay could not say which cell or block it acted on",
    };
  }
  return {
    ok: true,
    plan: {
      surface: engine,
      // The reporter's sentence travels with the plan: the verifier panel's
      // rubric attacks the EXPECTATION before the behaviour, and it cannot do
      // that without seeing what was expected.
      expectation: note,
      address,
      // No actions are invented. A plan whose steps came from a guess would be
      // replayed faithfully and mean nothing.
      actions: [],
      needsHumanSteps: true,
    },
  };
}

/** The command that would verify one item, given its route. */
export function verificationFor(item, { reportDir = "." } = {}) {
  if (item.route.destination === "verify") {
    const synth = synthesisePlan(item);
    if (!synth.ok) {
      return {
        itemId: item.id,
        lane: "appearance",
        reason: synth.reason,
        command: ["pnpm", "verify:browser:docker"],
      };
    }
    const planFile = path.join(reportDir, `${item.id}.plan.json`);
    const command = ["node", "./scripts/agent/hunt-ui.mjs", "replay", "--plan", planFile];
    // A SYNTHESISED PLAN CARRIES NO ACTIONS, and `hunt-ui` refuses to replay an
    // empty action list. Calling that lane `replay` and printing the command
    // promised a verification that could not run: the file was never written by
    // anything, so it died on ENOENT, and had it existed `hunt-ui` would have
    // said "no actions — cannot be replayed". The plan is a TEMPLATE, the file
    // is written, and the lane says what is missing.
    const pending = !synth.plan.actions || synth.plan.actions.length === 0;
    return {
      itemId: item.id,
      lane: pending ? "replay-pending-steps" : "replay",
      reason: pending
        ? `the sentence describes steps and the report names ${synth.plan.address} to act on, but the steps themselves cannot be synthesised — fill in \`actions\` in ${planFile}, then run the command`
        : "the sentence describes steps, and the report names an address to act on",
      command,
      planFile,
      plan: synth.plan,
    };
  }

  if (item.route.destination === "appearance") {
    return {
      itemId: item.id,
      lane: "appearance",
      reason: "no prediction and no plan; the visual lane produces the before/after/diff images",
      command: ["pnpm", "verify:browser:docker"],
      lens: "visual-intent",
      // The lens is NOT in the panel's shared manifest: it judges a change
      // against a reporter's sentence and a baseline/actual/diff set, and an
      // ordinary PR has neither. It is passed to the panel as its own directory.
      lensesDir: LENSES_DIR,
    };
  }

  return {
    itemId: item.id,
    lane: "none",
    reason:
      item.route.destination === "duplicate"
        ? "already reported; a comment needs no verification"
        : "too thin to verify; filed asking for more",
  };
}

/** Every verification a plan implies. */
export function planVerification(plan, { reportDir = "." } = {}) {
  const checks = plan.items.map((item) => verificationFor(item, { reportDir }));
  const counts = checks.reduce((acc, check) => {
    acc[check.lane] = (acc[check.lane] ?? 0) + 1;
    return acc;
  }, {});
  return {
    sessionId: plan.sessionId,
    checks,
    counts,
    // WRITTEN EMPTY, AND ALWAYS PRESENT. `report-back.mjs` reads
    // `verified.outcomes`, and this file did not have the key — so a replay that
    // failed produced no `lowered` entry, and the reporter was told their report
    // shipped as a clean PR. Whoever runs the lanes appends one entry per replay
    // (`report-verify.mjs record`, which is `applyReplayOutcome`).
    outcomes: [],
  };
}

/**
 * What a replay result means for the report.
 *
 * `reproduced` confirms it. Anything else LOWERS the destination to an issue that
 * carries both sides — and `unevaluable` is kept distinct from `refuted` for the
 * reason the prediction protocol keeps them apart: a comparison that could not be
 * carried out is not a finding, and collapsing the two would turn every malformed
 * plan into a verdict.
 */
export function applyReplayOutcome(item, outcome) {
  if (outcome?.reproduced === true) {
    return {
      itemId: item.id,
      destination: "verify",
      verified: true,
      note: "replay reproduced it",
    };
  }
  const why =
    outcome?.reason ??
    (outcome?.reproduced === false ? "replay did not reproduce it" : "replay could not be evaluated");
  return {
    itemId: item.id,
    destination: "issue",
    verified: false,
    // BOTH sides travel. The reporter's expectation is not overwritten by the
    // machine's failure to reproduce it.
    note: `filed with both the expectation and the failed replay — ${why}`,
    expectation: item.note,
    replay: outcome ?? null,
  };
}

/** One line per check, for a person reading a dry run. */
export function renderVerification(verification) {
  const lines = [
    `session ${verification.sessionId}: ${Object.entries(verification.counts)
      .map(([lane, n]) => `${n} ${lane}`)
      .join(" · ")}`,
  ];
  for (const check of verification.checks) {
    lines.push(`  ${check.itemId} → ${check.lane}: ${check.reason}`);
    if (check.command && check.lane !== "none") lines.push(`      ${check.command.join(" ")}`);
  }
  return lines.join("\n");
}

/**
 * Fold one replay result into a verification file.
 *
 * The step between "run the lanes" and "assemble the PRs" used to be "record each
 * result back into verified.json" with no tool to do it, so `applyReplayOutcome`
 * was reachable only from its own test while the flow it implements was a
 * hand-edit. Replacing an existing entry keeps a re-run idempotent.
 */
export function recordOutcome(verified, item, replay) {
  const outcome = applyReplayOutcome(item, replay);
  const outcomes = (verified.outcomes ?? []).filter((o) => o.itemId !== outcome.itemId);
  return { ...verified, outcomes: [...outcomes, outcome] };
}

function argOf(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function record(argv) {
  const verifiedFile = argOf(argv, "--verified");
  const planFile = argOf(argv, "--plan");
  const itemId = argOf(argv, "--item");
  const resultFile = argOf(argv, "--result");
  if (!verifiedFile || !planFile || !itemId) {
    process.stderr.write(
      "usage: report-verify.mjs record --verified <file> --plan <file> --item <id> [--result <file>]\n",
    );
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const item = plan.items.find((i) => i.id === itemId);
  if (!item) {
    process.stderr.write(`no item ${itemId} in ${planFile}\n`);
    process.exit(1);
  }
  const replay = resultFile ? JSON.parse(readFileSync(resultFile, "utf8")) : null;
  const verified = recordOutcome(JSON.parse(readFileSync(verifiedFile, "utf8")), item, replay);
  writeFileSync(verifiedFile, `${JSON.stringify(verified, null, 2)}\n`);
  const just = verified.outcomes.find((o) => o.itemId === itemId);
  process.stdout.write(`${itemId} → ${just.destination}: ${just.note}\n`);
}

function main(argv) {
  if (argv[0] === "record") return record(argv.slice(1));
  const planFile = argOf(argv, "--plan");
  if (!planFile) {
    process.stderr.write("usage: report-verify.mjs --plan <file> [--out <file>] [--dry-run]\n");
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const verification = planVerification(plan, { reportDir: path.dirname(planFile) });
  process.stdout.write(`${renderVerification(verification)}\n`);
  const out = argOf(argv, "--out");
  if (out) {
    writeFileSync(out, `${JSON.stringify(verification, null, 2)}\n`);
    // The plan files the printed commands read. Nothing wrote them before, so
    // every replay command died on ENOENT.
    for (const check of verification.checks) {
      if (check.planFile && check.plan) {
        writeFileSync(check.planFile, `${JSON.stringify(check.plan, null, 2)}\n`);
      }
    }
  }
  if (!argv.includes("--dry-run")) {
    // The lanes are not run from here on purpose: `hunt-ui replay` needs a
    // browser and the visual lane needs Docker, and both are the caller's to
    // schedule. Printing the commands keeps one code path for both modes.
    process.stdout.write("\nnothing was run — the commands above are the verification\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
