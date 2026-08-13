// Helpers both hunters' command-line front ends need.
//
// Extracted because `hunt-ui.mjs` had copied them out of `hunt.mjs` verbatim, and a
// copy is a rule that drifts. Only the genuinely IDENTICAL ones live here:
//
//   gitSha / repoSlug / makeChangedSince  — same code, same purpose, no hunter-specific
//                                            behaviour. Shared.
//   strArg                                 — identical apart from which `fail` it calls,
//                                            so it takes one.
//
// Deliberately NOT here, because they legitimately differ rather than merely look
// alike — moving them would be worse than the duplication:
//
//   fail        — the two prefix their messages differently (`hunt:` / `hunt-ui:`),
//                 which is the only thing distinguishing their output in a terminal.
//   parseArgs   — the UI hunter accepts `--surface` as a repeatable flag; the CLI
//                 hunter does not have the concept. A shared parser would have to
//                 know both vocabularies.
//
// Nothing here touches the SDK or any third-party package, so it loads in the
// `agent:tests` lane where `scripts/agent/node_modules` is absent.

import { execFileSync } from "node:child_process";
import { repoScopedEnv } from "./vendor/pipeline/git-env.mjs";

/**
 * The commit under test, or `"unknown"`.
 *
 * Never throws: a run outside a git checkout is still a useful run, and the sha is
 * report metadata rather than something the pipeline branches on.
 */
export function gitSha(repo) {
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
      env: repoScopedEnv(repo),
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * `owner/repo` for the issue corpus, or `null`.
 *
 * Resolved via `gh repo view` rather than by parsing `git remote get-url origin`:
 * this clone has three remotes (origin, fork, hwisoo) and the hardcoded-`origin`
 * assumption elsewhere in the harness does not hold here. Returns null rather than
 * guessing, and the caller warns that duplicate suppression is weaker.
 */
export function repoSlug(repo) {
  try {
    return (
      execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
        cwd: repo,
        encoding: "utf8",
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * Has anything under `globs` changed since `sha`? Drives ledger expiry.
 *
 * Fails toward "unchanged", which is the conservative direction here: treating a
 * defect as still-seen suppresses a re-report, while treating it as changed would
 * resurface everything the ledger exists to quieten.
 */
export function makeChangedSince(repo, globs) {
  return (sha) => {
    try {
      const out = execFileSync("git", ["-C", repo, "log", "--oneline", `${sha}..HEAD`, "--", ...globs], {
        env: repoScopedEnv(repo),
        encoding: "utf8",
      });
      return out.trim() !== "";
    } catch {
      return false; // cannot tell → treat as unchanged (conservative)
    }
  };
}

/**
 * Read a value-carrying flag.
 *
 * `parseArgs` sets a valueless flag (last token, or followed by another `--flag`) to
 * boolean `true`; neither hunter has a boolean flag, so that always means a missing
 * argument. `onMissing` is the caller's `fail`, so the error carries that hunter's
 * prefix rather than a generic one — and so `true` never reaches `path.resolve` as a
 * bare TypeError far from the typo that caused it.
 */
export function strArg(args, name, onMissing) {
  const v = args[name];
  if (v === true) onMissing(`--${name} needs a value`);
  return v;
}
