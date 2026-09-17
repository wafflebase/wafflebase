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
//   node ./scripts/agent/spec-to-pr.mjs review [--round N] [--fresh] [--rebuttals <f>] [--out <dir>] [--dry-run]
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
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { disclosesAiAuthorship, hasDisclosureTrailer, DISCLOSURE_TRAILER } from "./disclosure.mjs";
import { carryForwardFindings } from "./prior-findings.mjs";
import { findingKey } from "./finding-key.mjs";

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

/** The bound the workflow documents. Advisory here — see `roundBoundNotice`. */
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

/** The next round to run: one past the highest present, or 1. */
export function nextRound(entries) {
  const rounds = roundsIn(entries);
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
    `and get a human (or \`@claude review\`) onto it instead.`
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
 * The blocking findings, rendered for a terminal.
 *
 * Until now this command printed the ID of every failing lens and nothing else,
 * with the actual verdicts in a temp directory whose path was never shown. The
 * `findingKey` is here because it is the identifier a rebuttal is addressed to
 * (`rebuttal.mjs`'s record keys on it), so a developer who wants to dispute a
 * finding can copy it rather than reconstruct it.
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
    if (!Array.isArray(findings) || findings.length === 0) {
      lines.push(`  [blocking] ${lens} — no finding recorded (the lens may not have run)`);
      lines.push(`      read ${lens}/summary.md in the round directory`);
      continue;
    }
    for (const f of findings) {
      if (!f || typeof f !== "object") continue;
      const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "(no file cited)";
      lines.push(`  [${f.severity ?? "major"}] ${lens} — ${where}`);
      lines.push(`      ${String(f.summary ?? "").trim()}`);
      lines.push(`      key: ${findingKey(f)}`);
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
export function unsafeBaseReason(stat, uid) {
  if (!stat) return "it could not be inspected";
  if (typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink()) return "it is a symlink";
  if (typeof stat.isDirectory === "function" && !stat.isDirectory()) return "it is not a directory";
  // `uid` is undefined on platforms with no getuid (Windows); skip rather than
  // refuse every run there.
  if (typeof uid === "number" && typeof stat.uid === "number" && stat.uid !== uid) {
    return `it is owned by uid ${stat.uid}, not ${uid}`;
  }
  if (typeof stat.mode === "number" && (stat.mode & 0o077) !== 0) {
    return `it is group/other accessible (mode ${(stat.mode & 0o777).toString(8)})`;
  }
  return "";
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

/** `[{ round, lenses }]` for every round already written under `base`. */
export function roundsOnDisk(base) {
  return roundsIn(readdirSync(base)).map((round) => {
    const dir = path.join(base, `round-${round}`);
    const lenses = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, "verdict.json")))
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
  if (args.out !== undefined && typeof args.out !== "string") {
    return fail("--out needs a value (e.g. --out /tmp/my-review)");
  }
  const base = args.out ? path.resolve(args.out) : reviewBase(branch);
  // 0700 on creation, and refuse a pre-existing base that is not ours — see
  // `unsafeBaseReason`. Both matter because the path is predictable and its
  // contents are read back into a later round's prompt.
  mkdirSync(base, { recursive: true, mode: 0o700 });
  let baseStat = null;
  try {
    baseStat = lstatSync(base);
  } catch { /* unreadable → refused below */ }
  const unsafe = unsafeBaseReason(baseStat, typeof process.getuid === "function" ? process.getuid() : undefined);
  if (unsafe) return fail(`refusing to use the review directory ${base}: ${unsafe}`);
  // Bounded by construction: only this base's own round directories.
  if (args.fresh) {
    for (const name of roundDirsToClear(readdirSync(base))) {
      rmSync(path.join(base, name), { recursive: true, force: true });
    }
  }

  // `--round` with no value parses as `true`, and `Number(true)` is 1 — which
  // would silently overwrite round 1 instead of reporting a usage error. Reject
  // the boolean explicitly rather than letting a typo clobber a round's verdicts.
  if (args.round !== undefined && typeof args.round !== "string") {
    return fail("--round needs a value (e.g. --round 2)");
  }
  const round = args.round === undefined ? nextRound(readdirSync(base)) : Number(args.round);
  if (!Number.isInteger(round) || round < 1) {
    return fail(`--round must be a positive integer (got ${JSON.stringify(args.round)})`);
  }
  const notice = roundBoundNotice(round);
  if (notice) console.warn(`spec-to-pr: ${notice}`);

  const dir = path.join(base, `round-${round}`);
  mkdirSync(dir, { recursive: true });
  const diffFile = path.join(dir, "pr.diff");
  const changedFile = path.join(dir, "changed.txt");
  // The round directory IS the panel's `--out`: `<round-n>/<lens>/verdict.json`
  // is what the NEXT round reads back, so nesting it under a second directory
  // would only give `roundsOnDisk` one more level to agree about.
  const outDir = dir;
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
  // Round > 1 carries the earlier rounds' still-gating findings, so a finding
  // nobody fixed cannot vanish because THIS round's fresh pass happened to miss
  // it. Written into the round directory rather than piped, so a developer can
  // read what round N was told about round N-1.
  const prior = round > 1 ? priorFindingsFor(base, round) : [];
  const priorFile = path.join(dir, "prior-findings.json");
  if (prior.length > 0) writeFileSync(priorFile, JSON.stringify(prior, null, 2) + "\n");

  // The author's structured "this finding is wrong" claims, adjudicated by a
  // fresh subagent that is biased to uphold. The cloud reads these from hidden PR
  // comments (`rebuttal.mjs read <pr>`), which before a PR exists is nothing at
  // all — so locally the file is supplied by hand. Without it, a finding you
  // deliberately declined is re-raised identically for the rest of the loop.
  const rebuttals = args.rebuttals ? path.resolve(String(args.rebuttals)) : null;
  if (rebuttals && !existsSync(rebuttals)) return fail(`--rebuttals file not found: ${rebuttals}`);

  if (dryRun) {
    console.log(`[dry-run] round ${round} would review ${diffFile} via review-panel.mjs → ${outDir}`);
    if (prior.length > 0) console.log(`[dry-run] carrying ${prior.length} prior finding(s) from earlier rounds`);
    if (rebuttals) console.log(`[dry-run] adjudicating rebuttals from ${rebuttals}`);
    return;
  }
  console.log(`spec-to-pr: self-review round ${round} on ${branch} → ${outDir}`);
  if (prior.length > 0) console.log(`carrying ${prior.length} prior finding(s) forward`);
  try {
    execFileSync(
      "node",
      [
        path.join(HERE, "review-panel.mjs"),
        "--diff-file", diffFile,
        "--changed-files", changedFile,
        ...(baseSha ? ["--base-sha", baseSha] : []),
        ...(prior.length > 0 ? ["--prior-findings", priorFile] : []),
        ...(rebuttals ? ["--rebuttals", rebuttals] : []),
        "--lenses-dir", path.join(HERE, "lenses"),
        "--out", outDir,
      ],
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
        "       spec-to-pr.mjs review [--round N] [--fresh] [--rebuttals <file>] [--out <dir>] [--dry-run]",
    );
    process.exit(2);
  }
}
