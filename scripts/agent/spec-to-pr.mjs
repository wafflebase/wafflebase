// Local Spec → PR front door for the autonomous pipeline.
//
// The pipeline's back half (agent-iterate-ci.yml + agent-review-panel.yml) is
// triggered purely by CI `workflow_run` on same-repo `agent/*` branches — it is
// NOT coupled to issues. This helper is the deterministic handoff for a SECOND
// front door: a developer authors a spec locally, Claude Code implements + reviews
// + verifies on their machine, and this drives the last mile — push the branch,
// open the draft PR whose body satisfies the ready-gate disclosure check, and set
// the advisory state. The draft PR's `pull_request` event runs CI, and the proven
// back half picks the branch up identically to an issue-originated one.
//
// Fails CLOSED (exit non-zero) at every step: this is a local dev tool where a
// half-finished handoff should stop loudly, not silently.
//
// IMPORTANT — same-repo only: the back half requires
// head_repository == base repo, so the branch must be pushed to the BASE repo
// (fork pushes are rejected). This front door therefore works only for a
// developer with push rights to the base repo.
//
// THE `review` SUBCOMMAND IS NOT AGENT-TRACK-ONLY, despite this file's name. It
// diffs `origin/main...HEAD` and runs the panel; nothing about it wants an
// `agent/` branch, a PR, or a handoff. It is what `/self-review` drives on an
// ordinary feature branch, which is the only automated review such a branch ever
// gets: agent-review-panel.yml admits a PR only when its head branch starts with
// `agent/` or it carries the `agent:managed` label. `handoff` is the agent-track
// half.
//
// Usage:
//   node ./scripts/agent/spec-to-pr.mjs handoff --slug <slug> [--issue NN] [--title t] [--dry-run]
//   node ./scripts/agent/spec-to-pr.mjs review [--round N] [--fresh] [--force]
//        [--rebuttals <f>] [--out <dir>] [--dry-run]
//
// `review` keeps its rounds in a per-branch temp directory and carries each
// round's unfixed blocking findings into the next. It does NOT narrow the diff
// between rounds: the cloud's `--review-mode incremental` is decided by
// review-scope.mjs from a PR's own history, and a local loop has neither that
// history nor a reason to trade recall for latency on a diff this size.
//
// Pure helpers are exported and unit-tested (no gh/git). The CLI shells out to
// `git`/`gh` and to the sibling set-state.mjs / review-panel.mjs.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { disclosesAiAuthorship, hasDisclosureTrailer, DISCLOSURE_TRAILER } from "./disclosure.mjs";
import { carryForwardFindings } from "./prior-findings.mjs";
import { findingKeyOf } from "./rebuttal.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// --- pure helpers (exported for tests; no gh/git) --------------------------

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Branch slugs must be lowercase kebab (keeps `agent/<slug>` clean + shell-safe). */
export function isValidSlug(slug) {
  return typeof slug === "string" && SLUG_RE.test(slug);
}

/**
 * Render the draft-PR body from the PR template. The "Notes for Reviewers"
 * disclosure line is TRUE (this flow authors the PR autonomously) and worded to
 * satisfy `disclosesAiAuthorship` — the exact gate mark-ready enforces. A
 * self-check (below) refuses handoff if it ever fails, so this can't silently
 * produce a body the cloud gate would reject.
 */
export function renderPrBody({ slug = "", title = "", issue } = {}) {
  const summary = (title || `Implement ${slug}`).trim();
  const fixes = issue ? `Fixes #${issue}` : "Fixes #";
  const disclosure =
    "Authored autonomously by Claude Code (AI tools assisted) via the local " +
    "spec-to-PR flow. No human has verified these changes yet — please review " +
    "every line before approving.";
  return [
    "## Summary",
    "",
    summary,
    "",
    "## Why",
    "",
    "See the linked design doc / task file for the rationale and acceptance criteria.",
    "",
    "## Linked Issues",
    "",
    fixes,
    "",
    "## Verification",
    "",
    "- [ ] verify:self — CI comment shows ✅",
    "- [ ] verify:integration — CI comment shows ✅ (or explicit skip reason below)",
    "",
    "`pnpm verify:self` was run locally to green before handoff; CI re-runs the full lanes.",
    "",
    "## Risk Assessment",
    "",
    "- User-facing risk:",
    "- Data/security risk:",
    "- Rollback plan:",
    "",
    "## Notes for Reviewers",
    "",
    `- ${disclosure}`,
    "- Follow-up work (if any):",
  ].join("\n");
}

/** Given all commit messages in origin/main..HEAD, the ones MISSING the trailer. */
export function commitsMissingTrailer(messages) {
  return (Array.isArray(messages) ? messages : []).filter((m) => !hasDisclosureTrailer(m));
}

// --- git/gh-backed CLI -----------------------------------------------------

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}
function ghJson(args) {
  return JSON.parse(gh(args));
}

/** Parse "owner/repo" from a GitHub remote URL (https or ssh forms); null if it
 *  is not a recognizable github.com URL. Exported for unit tests. */
export function parseRepoFromRemoteUrl(url) {
  const m = String(url).match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

// Fail CLOSED — a half-finished local handoff must stop loudly.
function fail(msg) {
  console.error(`spec-to-pr: ${msg}`);
  process.exit(1);
}

// --- the local review loop's round bookkeeping ------------------------------
//
// The panel has always supported rounds; the LOCAL entry point never used them.
// It wrote to `mkdtempSync` — a fresh random directory per invocation, whose path
// it never even printed — so round N could not see round N-1 and the developer
// could not read the findings they were told to fix.
//
// A round is a directory: `<base>/round-<n>`. That is the whole state. Nothing is
// written outside the temp base, so an abandoned branch cleans itself up on
// reboot, and `--fresh` resets a branch deliberately.

/** The bound the workflow documents. ENFORCED — `--force` is the override. */
export const MAX_SELF_REVIEW_ROUNDS = 3;

export const ROUND_DIR_RE = /^round-(\d+)$/;

/** Round numbers present among directory entries, ascending. Junk ignored. */
export function roundsIn(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((name) => ROUND_DIR_RE.exec(String(name)))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
}

/**
 * The next round to run: one past the highest that ACTUALLY REVIEWED, or 1.
 *
 * `available` is `roundsOnDisk`'s output; a round whose `lenses` list is empty
 * produced no usable verdict and is not a round. That case is not hypothetical —
 * a panel run can end with every lens failing on an HTTP 429 usage limit, having
 * reviewed nothing at all, and it still leaves a directory behind. Counting it
 * would let a quota outage push a branch toward the three-round bound, which is
 * supposed to mean "this is not converging", not "the account ran out". The
 * retry reuses the number, and overwrites the empty directory.
 *
 * Falls back to the bare directory names when `available` is a plain string list,
 * so a caller that has not read the verdicts still gets the old behaviour.
 */
export function nextRound(available) {
  const rounds = Array.isArray(available) && available.some((e) => e && typeof e === "object")
    ? available.filter((e) => e && Array.isArray(e.lenses) && e.lenses.length > 0).map((e) => Number(e.round))
      .filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b)
    : roundsIn(available);
  return rounds.length === 0 ? 1 : rounds[rounds.length - 1] + 1;
}

/**
 * Which round each lens's carry-forward should come from: the LATEST round below
 * `round` in which that lens produced a verdict.
 *
 * Per-lens rather than "the previous round" wholesale, because that is what the
 * cloud does — `collectPrior` takes the latest check run PER LENS across every
 * commit, so a lens that crashed in round 2 still carries its round-1 findings
 * into round 3. Taking round-2-only would silently clear them, which is the
 * false negative the carry-forward exists to prevent.
 *
 * `available` is `[{ round, lenses: [id, …] }]`; order does not matter.
 */
export function pickLatestVerdicts(available, round) {
  const out = {};
  const seen = {};
  for (const entry of Array.isArray(available) ? available : []) {
    const r = Number(entry?.round);
    if (!Number.isInteger(r) || r < 1 || r >= round) continue;
    for (const lens of Array.isArray(entry?.lenses) ? entry.lenses : []) {
      if (typeof lens !== "string" || lens === "") continue;
      if (seen[lens] !== undefined && seen[lens] >= r) continue;
      seen[lens] = r;
      out[lens] = r;
    }
  }
  return out;
}

/**
 * The advisory the command prints when a round exceeds the documented bound.
 *
 * Deliberately NOT a refusal. The bound is a statement about convergence — three
 * rounds that still find blockers means the loop is not the right tool — and a
 * hard stop would also block the legitimate case where a developer reworked the
 * branch substantially and wants a fresh read. So it says the thing a refusal
 * would be trying to say, and lets the human decide.
 */
export function roundBoundNotice(round, max = MAX_SELF_REVIEW_ROUNDS) {
  if (!Number.isInteger(round) || round <= max) return "";
  return (
    `round ${round} is past the self-review bound of ${max}. A loop that has not ` +
    `converged in ${max} rounds is not going to converge in one more — open the PR ` +
    `and get a human (or \`@claude review\`) onto it instead. Pass --force to run ` +
    `it anyway (a substantially reworked branch is the case that earns it).`
  );
}

/**
 * TWO ENVIRONMENTS, ONE COMMAND. This is the credential contract for a local
 * review round, and the notice is just how the command says which half it is in:
 *
 *   - **CI** sets `CLAUDE_CODE_OAUTH_TOKEN` (and the `_1…_8` pool slots) from
 *     repository secrets. `buildSessionOptions` then pins that credential onto
 *     the session's `env`, which is what makes failover and per-job distribution
 *     work. Silent — this is the configured case.
 *   - **A developer's machine** has no such variable and does not need one: it
 *     has a logged-in Claude Code, and that session's credentials are what the
 *     round should spend. `createTokenPool` returns `null` for an empty pool and
 *     `buildSessionOptions` then omits the `env` override entirely, so the SDK
 *     resolves its own credentials — "an unconfigured environment keeps today's
 *     plain inheritance".
 *
 * `cmdReview` used to RETURN EARLY on the second case. That reads as prudence and
 * is the worst available behaviour: almost nobody exports a `claude setup-token`
 * credential on their own machine, so on the ordinary developer setup the local
 * review silently did not happen. For a branch that gets no cloud panel (no
 * `agent/` prefix, no `agent:managed` label) that is the difference between one
 * machine review and none — and a skip is easy to mistake for a pass.
 *
 * So the local case proceeds and says so. A machine with no credentials at all
 * still fails, with the SDK's own error, which names the problem better than this
 * wrapper could.
 */
export function ambientAuthNotice(env = process.env) {
  if (typeof env?.CLAUDE_CODE_OAUTH_TOKEN === "string" && env.CLAUDE_CODE_OAUTH_TOKEN.trim() !== "") return "";
  return (
    "no CLAUDE_CODE_OAUTH_TOKEN — using this machine's logged-in Claude Code " +
    "session, which is the intended local mode (CI pins a pooled credential " +
    "instead). This is a real multi-lens round and bills the account you are " +
    "logged in as."
  );
}

/**
 * One piece of model-written text, made safe to print.
 *
 * A finding's `summary` and `file` are MODEL OUTPUT, and they go straight to a
 * terminal that interprets escape sequences. An injected CSI sequence or a run of
 * carriage returns can erase or overwrite what is already on screen — and this
 * screen is the one a developer reads to decide whether the branch is clean, so
 * the text could hide the findings printed above it or forge a "no blocking
 * findings" line. Same reasoning as `neutral()` in rebuttal.mjs: text written by
 * the party under review is data, never markup.
 *
 * Every C0/C1 control becomes a space — ESC included, which is what defuses the
 * sequences — and the result is length-capped so one finding cannot scroll the
 * others off the screen.
 */
export function printable(text, max = 500) {
  const flattened = String(text ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flattened.length > max ? `${flattened.slice(0, max)}…` : flattened;
}

/**
 * The blocking findings, rendered for a terminal.
 *
 * Until now this command printed the ID of every failing lens and nothing else,
 * with the actual verdicts in a temp directory whose path was never shown.
 *
 * THE KEY IS `rebuttal.mjs`'s, NOT `finding-key.mjs`'s, and the two are different
 * strings for the same finding: `lens::file::first-six-summary-words` versus
 * `file::whole-lowercased-summary`. An earlier version of this function printed
 * the second while claiming it was the first, so a developer who copied it into a
 * `--rebuttals` record wrote a field in a shape nothing produces.
 *
 * It is also NOT how a rebuttal finds its finding — `matchRebuttal` uses
 * `findingSimilarity`, because the panel rewords the same defect between rounds
 * and an exact key would miss every re-worded one. The key is a grep handle and
 * the record's own identifier; the `lens`, `file` and `summary` printed above it
 * are what the match is actually made on, which is why all three are here.
 *
 * `entries` is `[{ lens, findings }]`.
 */

export function renderBlockingFindings(entries) {
  const lines = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== "object") continue;
    const { lens, findings } = entry;
    // A lens can CONCLUDE blocking and still have nothing printable here: the
    // synthesised "review could not run" record is dropped by the carry-forward
    // (it is not a code finding). Saying so is the point — a silent gap reads as
    // "the lens failed but found nothing", i.e. as noise to be overridden, when
    // it actually means the lens never reviewed.
    const lensName = printable(lens, 40);
    if (!Array.isArray(findings) || findings.length === 0) {
      lines.push(`  [blocking] ${lensName} — no finding recorded (the lens may not have run)`);
      lines.push(`      read ${lensName}/summary.md in the round directory`);
      continue;
    }
    for (const f of findings) {
      if (!f || typeof f !== "object") continue;
      // Every interpolated value here is model output — see `printable`.
      const where = f.file ? `${printable(f.file, 200)}${f.line ? `:${printable(f.line, 12)}` : ""}` : "(no file cited)";
      lines.push(`  [${printable(f.severity ?? "major", 12)}] ${lensName} — ${where}`);
      lines.push(`      ${printable(f.summary)}`);
      // Built from the finding's own lens, since `f.lens` may be absent on a
      // freshly-read verdict. `findingKeyOf` already caps itself at six summary
      // words, so this never truncates into an unusable string the way a capped
      // whole-summary key did.
      lines.push(`      key: ${printable(findingKeyOf({ ...f, lens: f.lens ?? lens }), 300)}`);
    }
  }
  return lines.join("\n");
}

function parseArgs(argv, start) {
  const a = {};
  for (let i = start; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      a[key] = true; // boolean flag (e.g. --dry-run)
    } else {
      a[key] = next;
      i++;
    }
  }
  return a;
}

/** Read the commit messages in origin/main..HEAD (record-separated, robust to
 * blank lines / multi-line bodies). */
function commitMessages() {
  const raw = execFileSync("git", ["log", "origin/main..HEAD", "--format=%B%x1e"], { encoding: "utf8" });
  return raw
    .split("\x1e")
    .map((s) => s.trim())
    .filter(Boolean);
}

function cmdHandoff(args) {
  const slug = args.slug;
  const dryRun = Boolean(args["dry-run"]);
  if (!isValidSlug(slug)) return fail(`invalid --slug '${slug}' (need ^[a-z0-9]+(-[a-z0-9]+)*$)`);
  const branch = `agent/${slug}`;
  const issue = args.issue ? String(args.issue).replace(/^#/, "") : undefined;
  if (issue && !/^\d+$/.test(issue)) return fail(`--issue must be a number (got '${args.issue}')`);
  const title = args.title || `Implement ${slug}`;

  // 2. current branch must be exactly agent/<slug>, and never main.
  let cur;
  try {
    cur = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch (e) {
    return fail(`could not read the current branch: ${e.message}`);
  }
  if (cur === "main") return fail("refusing to run on main");
  if (cur !== branch) return fail(`current branch is '${cur}', expected '${branch}' — checkout the agent branch first`);

  // 2.5 origin must be the BASE repo, not a fork. The handoff pushes to origin and
  // opens the PR from it; a fork PR is rejected by the back half (fork-originated
  // workflow_run events), so it would never run the pipeline. Resolve origin and
  // refuse if it is a fork — and pass the base repo explicitly to `gh pr create`.
  let originUrl;
  try {
    originUrl = git(["remote", "get-url", "origin"]);
  } catch (e) {
    return fail(`could not read the 'origin' remote: ${e.message}`);
  }
  const origin = parseRepoFromRemoteUrl(originUrl);
  if (!origin) return fail(`the 'origin' remote (${originUrl}) is not a recognizable GitHub URL`);
  let originInfo;
  try {
    originInfo = ghJson(["api", `repos/${origin}`]);
  } catch (e) {
    return fail(`could not resolve the origin repo (${origin}): ${e.message}`);
  }
  if (originInfo.fork) {
    return fail(
      `origin (${originInfo.full_name}) is a FORK — the handoff must target the base repo ` +
        `${originInfo.parent?.full_name || "(its upstream)"}, or the back half rejects the PR and the ` +
        `pipeline never runs. Re-run in a clone whose 'origin' points to the base repo.`,
    );
  }
  const baseRepo = originInfo.full_name;

  // 3. at least one commit ahead of origin/main, every one carrying the trailer.
  try {
    git(["fetch", "origin", "main"]);
  } catch (e) {
    return fail(`could not fetch origin/main: ${e.message}`);
  }
  const messages = commitMessages();
  if (messages.length === 0) return fail("no commits ahead of origin/main — nothing to hand off");
  const missing = commitsMissingTrailer(messages);
  if (missing.length > 0) {
    return fail(
      `${missing.length} of ${messages.length} commit(s) are missing the '${DISCLOSURE_TRAILER}' trailer. ` +
        "Export WAFFLEBASE_AGENT_AUTONOMOUS=true so the require-ai-disclosure hook enforces it, and amend.",
    );
  }

  // 5. slug uniqueness: refuse if the branch already exists on origin (would
  // collide with / clobber an in-flight branch the cloud loop may own).
  let remote;
  try {
    remote = git(["ls-remote", "--heads", "origin", branch]);
  } catch (e) {
    return fail(`could not check origin for ${branch}: ${e.message}`);
  }
  if (remote) return fail(`branch ${branch} already exists on origin — pick a fresh slug`);

  // 4. render + self-check the body against the EXACT ready-gate predicate.
  const body = renderPrBody({ slug, title, issue });
  if (!disclosesAiAuthorship(body)) return fail("rendered PR body fails the disclosure gate (internal bug)");

  if (dryRun) {
    console.log("[dry-run] would hand off:");
    console.log(`  branch:  ${branch} (${messages.length} commit(s), all carry the trailer)`);
    console.log(`  push:    git push -u origin ${branch}`);
    console.log(`  pr:      gh pr create --repo ${baseRepo} --draft --base main --title "${title}"`);
    console.log(`  state:   node ./scripts/agent/set-state.mjs <pr> awaiting-ci`);
    console.log("  --- PR body ---");
    console.log(body);
    return;
  }

  // 6. first push of the branch (it's brand-new on origin — can't conflict).
  try {
    git(["push", "-u", "origin", branch]);
  } catch (e) {
    return fail(`git push failed: ${e.message}`);
  }

  // 7. open the DRAFT PR (this is the CI trigger — pull_request:[main]).
  const dir = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-"));
  const bodyFile = path.join(dir, "pr-body.md");
  writeFileSync(bodyFile, body);
  try {
    gh(["pr", "create", "--repo", baseRepo, "--draft", "--base", "main", "--head", branch, "--title", title, "--body-file", bodyFile]);
  } catch (e) {
    return fail(`gh pr create failed: ${e.message}`);
  }

  // 8. advisory state → awaiting-ci (code pushed, CI pending). The back half's
  // panel/reconcile advance it from here.
  let pr = "";
  try {
    pr = String(ghJson(["pr", "view", branch, "--json", "number"]).number);
    execFileSync("node", [path.join(HERE, "set-state.mjs"), pr, "awaiting-ci"], { stdio: "inherit" });
  } catch (e) {
    console.warn(`spec-to-pr: PR opened but could not set the advisory state: ${e.message}`);
  }

  // 9. hand off ownership loudly.
  console.log("\n✅ Draft PR opened for " + branch + (pr ? ` (#${pr})` : ""));
  console.log("⚠️  This branch is now CLOUD-OWNED. The CI-fix and review-panel loops will");
  console.log("    push follow-up commits to it. DO NOT push to it again — a local push");
  console.log("    races the cloud fixer, and a force-push would clobber its commits and");
  console.log("    break the append-only loop counters. End this session now.");
  if (pr) console.log(`\nPreview the ready-gate locally (no promotion): node ./scripts/agent/mark-ready.mjs ${pr}`);
}

/**
 * Why this base directory must not be used, or "" if it is fine.
 *
 * The base is PREDICTABLE — it has to be, since round N finds round N-1 by
 * path — which is a property `mkdtempSync` (0700, random) gave away for free and
 * this does not. Two things follow on a shared machine, and the second is the
 * serious one:
 *
 *   - the branch diff (`pr.diff`) and every verdict sit in a world-readable
 *     directory under a shared `/tmp`; and
 *   - `priorFindingsFor` reads `verdict.json` back and feeds it into the next
 *     round's verifier prompt. Anyone who can write that path can put text into
 *     an agent session holding the developer's credentials and repo access.
 *
 * So the directory is created 0700 and REFUSED if it already exists as anything
 * else: a symlink (the classic pre-creation attack — `mkdirSync` on a symlink to
 * a directory succeeds, and the writes land wherever it points), a non-directory,
 * something another user owns, or a directory with any group/other bit set.
 *
 * Fails closed: an unreadable or un-stattable base is refused too. Pure so the
 * decision is testable without staging a hostile /tmp.
 */
export function unsafeBaseReason(stat, uid, { leaf = true } = {}) {
  if (!stat) return "it could not be inspected";
  if (typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink()) return "it is a symlink";
  if (typeof stat.isDirectory === "function" && !stat.isDirectory()) return "it is not a directory";
  // OWNERSHIP IS A LEAF RULE. Our own directory must be ours. An ancestor need
  // not be — `/private/tmp` belongs to root, and root-owned is safer than ours,
  // not less safe. Requiring it here refused every run on macOS.
  //
  // `uid` is undefined on platforms with no getuid (Windows); skip rather than
  // refuse every run there.
  if (leaf && typeof uid === "number" && typeof stat.uid === "number" && stat.uid !== uid) {
    return `it is owned by uid ${stat.uid}, not ${uid}`;
  }
  if (typeof stat.mode !== "number") return "";
  // TWO RULES, because the two positions answer different questions.
  //
  // The LEAF holds the branch diff and the JSON fed to the next round's verifier,
  // so anyone who can READ it learns the change under review, and 0700 is the bar.
  //
  // An ANCESTOR is only dangerous if somebody else can WRITE it: that is what
  // lets another user replace or relocate our directory between the check and the
  // writes (CWE-367). Requiring 0700 there instead would refuse every ordinary
  // location — `/Users`, `/home` and most home directories are 0755 — which is
  // why an earlier version checked no ancestor at all under `--out` and left the
  // race open. A sticky bit (`/tmp`) makes a world-writable directory safe again,
  // since only an entry's owner may replace it.
  const STICKY = 0o1000;
  const forbidden = leaf ? 0o077 : 0o022;
  if ((stat.mode & forbidden) !== 0 && !(!leaf && (stat.mode & STICKY) !== 0)) {
    return leaf
      ? `it is group/other accessible (mode ${(stat.mode & 0o777).toString(8)})`
      : `it is writable by another user and not sticky (mode ${(stat.mode & 0o7777).toString(8)})`;
  }
  return "";
}

/**
 * The directories this command created, leaf first, stopping below `stopAt`.
 *
 * `mkdirSync(base, { recursive: true })` makes intermediates too, and they are
 * ours to validate for the same reason the leaf is — see the call site. `stopAt`
 * is the boundary we did NOT create (the system temp directory, or the parent a
 * caller pointed `--out` at), so it is excluded: refusing to run because
 * `/tmp` is world-writable would refuse every run on every machine.
 *
 * Returns [] rather than looping forever if `base` is not under `stopAt`.
 */
export function ownedPathChain(base, stopAt) {
  const stop = path.resolve(String(stopAt));
  const chain = [];
  let cur = path.resolve(String(base));
  // `parse().root` terminates the walk on a path that never meets `stop`.
  while (cur !== stop && cur !== path.parse(cur).root) {
    chain.push(cur);
    cur = path.dirname(cur);
  }
  return cur === stop ? chain : [];
}

/**
 * Usage errors in `review`'s arguments, or "" — pure so the guards are testable
 * without spawning the command.
 *
 * `parseArgs` turns a flag with no value into `true`, and both of these were
 * silent data loss rather than a usage error: `Number(true)` is 1, so `--round`
 * alone overwrote round 1, and `path.resolve(String(true))` is `./true`, which
 * `--fresh` would then have deleted.
 */
export function reviewArgsError(args) {
  const a = args ?? {};
  if (a.out !== undefined && typeof a.out !== "string") return "--out needs a value (e.g. --out /tmp/my-review)";
  if (a.round !== undefined && typeof a.round !== "string") return "--round needs a value (e.g. --round 2)";
  if (a.rebuttals !== undefined && typeof a.rebuttals !== "string") return "--rebuttals needs a file path";
  if (a.round !== undefined) {
    const n = Number(a.round);
    if (!Number.isInteger(n) || n < 1) return `--round must be a positive integer (got ${JSON.stringify(a.round)})`;
  }
  return "";
}

/**
 * Hand-written rebuttal records, normalized the way the cloud's are.
 *
 * `review-panel.mjs` partitions rebuttals with `r.lens === lensId` against the
 * BARE lens id, and the cloud's records satisfy that because they arrive through
 * `parseRebuttalComment`, which strips an `agent-review-` prefix on the way in.
 * The local `--rebuttals` file is written by hand and goes straight to the panel,
 * skipping that parser — so a developer who copied the check-run name (the most
 * natural thing to copy: it is what GitHub shows) would file a rebuttal that
 * matches no lens and adjudicates nothing, silently. Losing an argument you were
 * never told was not heard is the worst failure this path has.
 *
 * Only the prefix is touched. Everything else is the author's claim, which the
 * adjudicator is supposed to read as written.
 */
export function normalizeRebuttals(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((r) => r && typeof r === "object" && !Array.isArray(r))
    .map((r) => (typeof r.lens === "string" ? { ...r, lens: r.lens.trim().replace(/^agent-review-/, "") } : r));
}

/**
 * Write a round's file inputs and return the paths the panel should be given.
 *
 * Extracted because the gap three consecutive rounds kept raising was not in
 * either end — `carryForwardFindings` and `panelArgs` are both tested — but in
 * the WIRING between them: that the carried findings are actually written, and
 * that the path of the file just written is the path handed to the panel. A
 * defect there produces a completely normal-looking run that reviews without its
 * carry-forward, which is the failure this whole change exists to prevent.
 *
 * Returns `{ priorFile, rebuttals, rebuttalCount }`, where a null path means
 * "pass no flag" — absent and empty are different claims to the panel (see
 * `panelArgs`).
 *
 * Throws on an unusable `--rebuttals` file rather than skipping it. The panel
 * treats an unreadable one as "no rebuttals", so ignoring it would let a dispute
 * go silently unheard, which is strictly worse than refusing to start.
 */
/**
 * Read and normalize a `--rebuttals` file, or throw saying why not.
 *
 * Split from the writing so BOTH modes can validate: a dry run has nothing to
 * write but must still refuse a file the real run would, or it answers the one
 * question it exists to answer — "what will happen" — wrongly.
 */
export function readRebuttalRecords(file) {
  if (!existsSync(file)) throw new Error(`--rebuttals file not found: ${file}`);
  let records;
  try {
    records = normalizeRebuttals(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    throw new Error(`--rebuttals file is not a readable JSON array: ${file} (${e.message})`);
  }
  if (records.length === 0) throw new Error(`--rebuttals file holds no usable records: ${file}`);
  return records;
}

export function prepareRoundInputs({ dir, prior, rebuttalsPath }) {
  const carried = Array.isArray(prior) ? prior : [];
  let priorFile = null;
  if (carried.length > 0) {
    priorFile = path.join(dir, "prior-findings.json");
    writeFileSync(priorFile, JSON.stringify(carried, null, 2) + "\n");
  }
  if (!rebuttalsPath) return { priorFile, rebuttals: null, rebuttalCount: 0 };
  const records = readRebuttalRecords(rebuttalsPath);
  // The NORMALIZED copy is what the panel reads, written beside the round it
  // belongs to so the argument is auditable after the fact.
  const rebuttals = path.join(dir, "rebuttals.json");
  writeFileSync(rebuttals, JSON.stringify(records, null, 2) + "\n");
  return { priorFile, rebuttals, rebuttalCount: records.length };
}

/**
 * The argv handed to `review-panel.mjs`.
 *
 * Extracted so the round inputs are ASSERTED rather than eyeballed. The whole
 * point of this change is that `--prior-findings` and `--rebuttals` reach the
 * panel — the previous local entry point built a nearly identical argv that
 * omitted both, and nothing failed when it did. A flag that silently stops being
 * passed produces a panel run that looks completely normal and quietly reviews
 * without its carry-forward, which is the failure this file's own history is
 * made of.
 *
 * Each optional input is omitted when absent rather than passed empty: the panel
 * treats a missing `--prior-findings` as "first round" and an empty one as "the
 * previous round found nothing", and those are different claims.
 */
export function panelArgs({ panel, diffFile, changedFile, baseSha, priorFile, rebuttals, lensesDir, outDir }) {
  return [
    panel,
    "--diff-file", diffFile,
    "--changed-files", changedFile,
    ...(baseSha ? ["--base-sha", baseSha] : []),
    ...(priorFile ? ["--prior-findings", priorFile] : []),
    ...(rebuttals ? ["--rebuttals", rebuttals] : []),
    "--lenses-dir", lensesDir,
    "--out", outDir,
  ];
}

/**
 * The entries `--fresh` may delete: this base's own round directories, nothing
 * else.
 *
 * It used to `rmSync(base, { recursive: true, force: true })`, which deletes
 * whatever `--out` names — `--out ~/project --fresh` would take the project with
 * it. `parseArgs` makes that worse than a typo away: `--out --fresh` yields
 * `out: true`, and `path.resolve(String(true))` is `./true`.
 *
 * "Fresh" means "discard the rounds", so deleting exactly the directories this
 * tool created expresses the intent AND is bounded by construction, whatever the
 * caller aimed `--out` at.
 */
export function roundDirsToClear(entries) {
  return roundsIn(entries).map((round) => `round-${round}`);
}

/**
 * Where this branch's rounds live. Keyed by branch so two branches never
 * interleave rounds, and hashed so two branch names that sanitize to the same
 * string cannot share a slot.
 */
function reviewBase(branch) {
  const safe = String(branch).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60);
  const hash = createHash("sha1").update(String(branch)).digest("hex").slice(0, 8);
  return path.join(os.tmpdir(), "wafflebase-self-review", `${safe}-${hash}`);
}

/**
 * Did this lens actually REVIEW in this round?
 *
 * "A verdict.json exists" is not the same question, and reading it as one broke
 * the per-lens rule from the inside. `review-panel.mjs` writes a verdict file for
 * a lens it SKIPPED (`{ valid: true, conclusion: "skipped" }`, when the lens does
 * not apply to this diff) and for one that CRASHED or hit a quota error
 * (`{ valid: false }`, holding only the synthesised "review did not run" record,
 * which `carryForwardFindings` correctly drops). Either file made
 * `pickLatestVerdicts` select that round for the lens, and the lens then carried
 * NOTHING — silently discarding the real findings it raised in an earlier round.
 *
 * That is precisely the false negative the per-lens rule exists to prevent, so the
 * predicate has to match what the panel means by a verdict: valid, and not a skip.
 * An unusable round is invisible here, which lets the lens keep reaching further
 * back — the same thing `collectPrior` gets from taking the latest *check run*
 * that carries findings.
 */
export function verdictProduced(verdict) {
  if (!verdict || typeof verdict !== "object") return false;
  if (verdict.valid !== true) return false;
  return verdict.conclusion !== "skipped";
}

/** `[{ round, lenses }]` for every round whose lens produced a usable verdict. */
export function roundsOnDisk(base) {
  return roundsIn(readdirSync(base)).map((round) => {
    const dir = path.join(base, `round-${round}`);
    const lenses = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => {
        try {
          return verdictProduced(JSON.parse(readFileSync(path.join(dir, e.name, "verdict.json"), "utf8")));
        } catch {
          return false; // absent or unparseable → this round did not settle the lens
        }
      })
      .map((e) => e.name);
    return { round, lenses };
  });
}

/**
 * Assemble this round's `--prior-findings` from the rounds already on disk.
 *
 * Never throws: a verdict that will not parse carries nothing for that lens,
 * matching `tagPriorFindings`' per-lens fail direction. Carrying fewer findings
 * is the safe failure — prior findings can only ever re-raise a blocker.
 */
export function priorFindingsFor(base, round) {
  const picks = pickLatestVerdicts(roundsOnDisk(base), round);
  const out = [];
  for (const [lens, from] of Object.entries(picks)) {
    try {
      const verdict = JSON.parse(readFileSync(path.join(base, `round-${from}`, lens, "verdict.json"), "utf8"));
      out.push(...carryForwardFindings(verdict, lens));
    } catch { /* this lens carries nothing */ }
  }
  return out;
}

/** Gating findings per failing lens, for the terminal report. */
function blockingFindingsIn(outDir, lensIds) {
  const entries = [];
  for (const lens of lensIds) {
    try {
      const verdict = JSON.parse(readFileSync(path.join(outDir, lens, "verdict.json"), "utf8"));
      entries.push({ lens, findings: carryForwardFindings(verdict, lens) });
    } catch { /* the summary above still names the lens */ }
  }
  return entries;
}

function cmdReview(args) {
  const dryRun = Boolean(args["dry-run"]);
  const authNotice = ambientAuthNotice(process.env);
  if (authNotice) console.warn(`spec-to-pr: ${authNotice}`);
  let branch;
  try {
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch (e) {
    return fail(`could not read the current branch: ${e.message}`);
  }
  const argError = reviewArgsError(args);
  if (argError) return fail(argError);
  const base = args.out ? path.resolve(args.out) : reviewBase(branch);
  // 0700 on creation, and refuse a directory that is not ours — see
  // `unsafeBaseReason`. This matters because the path is predictable and its
  // contents are read back into a later round's prompt.
  //
  // EVERY ANCESTOR, not just the leaf, and whoever made it. Two earlier versions
  // got the scope wrong in opposite directions: checking only the leaf left an
  // attacker-owned `<tmp>/wafflebase-self-review` free to redirect every write,
  // and checking "only the levels we created" was worse, since a pre-existing
  // ancestor — exactly the one an attacker supplies — was skipped by definition.
  //
  // `--out` is no longer an exception. It was, on the reasoning that walking up a
  // developer's own path would refuse ordinary locations, and that was true of
  // the rule being applied: 0700 would reject `/Users`. But an ancestor does not
  // need to be private, only un-replaceable by somebody else, so it is checked
  // for foreign WRITE access instead (see `unsafeBaseReason`). `/Users` and a
  // 0755 home pass that; a world-writable non-sticky directory does not, and that
  // is the one that makes the TOCTOU real.
  //
  // The walk stops below the filesystem root, and `os.tmpdir()` is included
  // rather than assumed: it is sticky on every system that matters, which the
  // ancestor rule accepts explicitly.
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  // The LEAF is inspected unresolved: it has to be our own directory, not a
  // symlink somebody planted where ours was going to be.
  let leafStat = null;
  try {
    leafStat = lstatSync(base);
  } catch { /* unreadable → refused below */ }
  const leafUnsafe = unsafeBaseReason(leafStat, uid, { leaf: true });
  if (leafUnsafe) return fail(`refusing to use the review directory ${base}: ${leafUnsafe}`);
  // ANCESTORS are walked RESOLVED. `/var` is a symlink to `/private/var` on every
  // Mac, and `os.tmpdir()` sits under it — rejecting a symlinked ancestor refused
  // every run on the platform. Resolving first asks the question that actually
  // matters about an ancestor (can a third party replace it?) of the directory
  // the writes will really land in.
  let resolved = base;
  try {
    resolved = realpathSync(base);
  } catch { /* fall back to the literal path */ }
  for (const dir of ownedPathChain(path.dirname(resolved), path.parse(resolved).root)) {
    let st = null;
    try {
      st = lstatSync(dir);
    } catch { /* unreadable → refused below */ }
    const unsafe = unsafeBaseReason(st, uid, { leaf: false });
    if (unsafe) return fail(`refusing to use the review directory ${base}: its ancestor ${dir} — ${unsafe}`);
  }
  // Bounded by construction: only this base's own round directories. Skipped
  // under `--dry-run` — a dry run that deleted the rounds it claims only to
  // report on is the same defect as one that consumes a round number, and this
  // one destroys the verdicts a later round would have carried forward.
  if (args.fresh && !dryRun) {
    for (const name of roundDirsToClear(readdirSync(base))) {
      rmSync(path.join(base, name), { recursive: true, force: true });
    }
  }

  // Validated by `reviewArgsError` above. Read from the VERDICTS, not the
  // directory names, so a round that reviewed nothing (a 429 leaves a full set of
  // empty ones) does not consume a number. Under `--dry-run --fresh` nothing was
  // deleted, so the rounds are discounted here instead — a dry run has to report
  // the round the real run would use, not the one the un-cleared directory has.
  const onDisk = args.fresh ? [] : roundsOnDisk(base);
  const round = args.round === undefined ? nextRound(onDisk) : Number(args.round);
  // REFUSED, not warned. A warning that still runs the round is not a bound: the
  // documented maximum said one thing and the tool did another, and a loop that
  // is not converging would keep spending on itself. `--force` is the override,
  // because the legitimate case exists (a branch reworked enough to deserve a
  // fresh read) and `--fresh` is not it — that discards the carry-forward, which
  // is the opposite of what a fourth round needs.
  const notice = roundBoundNotice(round);
  if (notice && !args.force) return fail(notice);
  if (notice) console.warn(`spec-to-pr: --force: ${notice}`);

  const dir = path.join(base, `round-${round}`);
  // A DRY RUN MUST NOT CONSUME A ROUND. Creating the directory here is what makes
  // `nextRound` count it, so every `--dry-run` used to burn a round number and
  // leave a directory holding a diff no lens ever read. Two probes of this
  // command pushed a real round from 3 to 5, which then tripped the round bound.
  // Everything below this point is read-only or reported, so the dry run reports
  // from the same values the real run would use and writes none of them.
  if (dryRun) {
    const dryPrior = round > 1 ? priorFindingsFor(base, round) : [];
    // The rebuttals file is VALIDATED here too, not just named. A dry run that
    // announced it would adjudicate a file the real run rejects is the one answer
    // this mode must never give — it exists to tell you what will happen.
    // Validation only: nothing is written, so the round stays unconsumed.
    let dryRebuttals = 0;
    if (args.rebuttals) {
      try {
        dryRebuttals = readRebuttalRecords(path.resolve(String(args.rebuttals))).length;
      } catch (e) {
        return fail(e.message);
      }
    }
    console.log(`[dry-run] round ${round} would review origin/main...HEAD via review-panel.mjs → ${dir}`);
    if (dryPrior.length > 0) console.log(`[dry-run] carrying ${dryPrior.length} prior finding(s) from earlier rounds`);
    if (dryRebuttals > 0) console.log(`[dry-run] adjudicating ${dryRebuttals} rebuttal(s) from ${path.resolve(String(args.rebuttals))}`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  const diffFile = path.join(dir, "pr.diff");
  const changedFile = path.join(dir, "changed.txt");
  // The round directory IS the panel's `--out`: `<round-n>/<lens>/verdict.json`
  // is what the NEXT round reads back, so nesting it under a second directory
  // would only give `roundsOnDisk` one more level to agree about.
  const outDir = dir;

  // BEFORE the network and the diff, because every failure below this line is a
  // usage error the caller can fix from the message alone. Ordered the other way
  // round, a mistyped `--rebuttals` path cost a fetch and two `git diff`s first —
  // and on a repository where the diff cannot be built (a shallow clone has no
  // merge base) it reported THAT instead, which is a confusing answer to a
  // question the caller never asked.
  const prior = round > 1 ? priorFindingsFor(base, round) : [];
  let inputs;
  try {
    inputs = prepareRoundInputs({ dir, prior, rebuttalsPath: args.rebuttals ? path.resolve(String(args.rebuttals)) : null });
  } catch (e) {
    return fail(e.message);
  }
  if (inputs.rebuttalCount > 0) console.log(`adjudicating ${inputs.rebuttalCount} rebuttal(s)`);

  try {
    git(["fetch", "origin", "main"]);
    writeFileSync(diffFile, execFileSync("git", ["diff", "origin/main...HEAD"], { encoding: "utf8" }));
    writeFileSync(changedFile, execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], { encoding: "utf8" }));
  } catch (e) {
    return fail(`could not build the working diff: ${e.message}`);
  }
  // The merge-base the novelty gate dates findings against — the SAME endpoint
  // the `...` diff above uses, so this local gate and the CI one agree about
  // what counts as already-there. Separately try/caught and best-effort on
  // purpose: without it the gate just runs inert (every finding stays blocking),
  // which is the pre-gate behaviour and the safe direction, so it must not turn
  // a reviewable diff into a hard failure.
  let baseSha = null;
  try {
    baseSha = execFileSync("git", ["merge-base", "origin/main", "HEAD"], { encoding: "utf8" }).trim();
  } catch { /* gate runs inert */ }
  console.log(`spec-to-pr: self-review round ${round} on ${branch} → ${outDir}`);
  if (prior.length > 0) console.log(`carrying ${prior.length} prior finding(s) forward`);
  try {
    execFileSync(
      "node",
      panelArgs({
        panel: path.join(HERE, "review-panel.mjs"),
        diffFile,
        changedFile,
        baseSha,
        priorFile: inputs.priorFile,
        rebuttals: inputs.rebuttals,
        lensesDir: path.join(HERE, "lenses"),
        outDir,
      }),
      { stdio: "inherit" },
    );
  } catch (e) {
    return fail(`local review panel failed: ${e.message}`);
  }
  // Report blocking lenses from panel.json (failure = blocking).
  let panel = [];
  try {
    panel = JSON.parse(readFileSync(path.join(outDir, "panel.json"), "utf8"));
  } catch {
    return fail("review panel produced no panel.json — treat as blocking and inspect the output above");
  }
  const blocking = panel.filter((p) => p && p.applicable !== false && p.conclusion !== "success" && p.conclusion !== "skipped");
  console.log(`Round ${round} output: ${outDir}`);
  if (blocking.length > 0) {
    console.error(`spec-to-pr: ${blocking.length} blocking lens verdict(s): ${blocking.map((p) => p.id).join(", ")}`);
    const report = renderBlockingFindings(blockingFindingsIn(outDir, blocking.map((p) => p.id)));
    if (report !== "") console.error(`\n${report}\n`);
    console.error(
      `Fix these, keep \`pnpm verify:fast\` green, then re-run for round ${round + 1}. ` +
        "A finding you believe is wrong belongs in a --rebuttals file, not in silence — " +
        "an un-rebutted finding is re-raised every round.",
    );
    process.exit(1);
  }
  console.log(`Local review panel: no blocking findings (round ${round}). The loop can stop here.`);
}

// Only run the CLI when executed directly (not when imported for tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const args = parseArgs(process.argv, 3);
  if (cmd === "handoff") cmdHandoff(args);
  else if (cmd === "review") cmdReview(args);
  else {
    console.error(
      "usage: spec-to-pr.mjs handoff --slug <slug> [--issue NN] [--title t] [--dry-run]\n" +
        "       spec-to-pr.mjs review [--round N] [--fresh] [--force] [--rebuttals <file>] [--out <dir>] [--dry-run]",
    );
    process.exit(2);
  }
}
