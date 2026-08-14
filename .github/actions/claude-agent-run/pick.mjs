// Choose this job's credential, and the one to fall back to, for the
// claude-code-action lane.
//
// The SDK lane picks inside the process (ask.mjs); claude-code-action takes its
// token as an INPUT, so the choice has to happen before the step runs. Same two
// rules either way — one token per job, switch only on exhaustion — and the same
// module makes the choice, so the two lanes cannot drift apart. That import is
// why this file lives next to the action but reaches back into the repo: a local
// composite action is only usable after checkout, so the path always resolves.
//
// Prints ONLY the mask directive and the outputs. A token never reaches stdout
// unmasked, and never reaches the step summary at all.

import { appendFileSync } from "node:fs";
import { createTokenPool } from "../../../scripts/agent/token-pool.mjs";

/**
 * One GitHub Actions output in delimiter form.
 *
 * `name=value` would be enough for a token, but the heredoc form is unambiguous
 * for the EMPTY value — which is the normal case for `backup` on a single-token
 * pool, and the value the ladder's `if:` reads to decide there is nothing to
 * fail over to.
 */
export function outputLine(name, value) {
  return `${name}<<CLAUDE_TOKEN_EOF\n${value}\nCLAUDE_TOKEN_EOF`;
}

function main() {
  const pool = createTokenPool();
  const primary = pool.current() ?? "";
  // One level of failover is what a step ladder can express. A pool deep enough
  // for two simultaneous closed windows is rare, and the SDK lane — which is
  // where the volume is — walks the whole pool rather than stopping at two.
  const backup = primary ? (pool.advance("failover slot") ?? "") : "";

  // Mask before anything else can echo them. Registered secrets are masked by
  // the runner already; this covers the case where a token is supplied by
  // something other than a repository secret.
  for (const token of [primary, backup]) if (token) console.log(`::add-mask::${token}`);

  const out = process.env.GITHUB_OUTPUT;
  if (!out) throw new Error("GITHUB_OUTPUT is unset — this script only runs inside a job step");
  appendFileSync(
    out,
    [
      outputLine("primary", primary),
      outputLine("backup", backup),
      // A boolean twin so the ladder can branch on "is there a failover" without
      // putting a credential inside an `if:` or a `run:` string. Repo convention
      // keeps secrets out of shell commands; a token compared in an expression
      // is the same mistake wearing a different hat.
      outputLine("has_backup", backup ? "true" : "false"),
    ].join("\n") + "\n",
  );

  // Counts only. Which slot was selected is deliberately not logged: it would
  // let anyone reading a public log correlate failures to a specific secret.
  console.log(`Credential pool: ${pool.size} registered, ${backup ? "1 failover available" : "no failover"}`);
}

main();
