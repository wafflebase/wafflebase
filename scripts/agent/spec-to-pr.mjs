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
// Usage:
//   node ./scripts/agent/spec-to-pr.mjs handoff --slug <slug> [--issue NN] [--title t] [--dry-run]
//   node ./scripts/agent/spec-to-pr.mjs review [--dry-run]
//
// Pure helpers are exported and unit-tested (no gh/git). The CLI shells out to
// `git`/`gh` and to the sibling set-state.mjs / review-panel.mjs.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { disclosesAiAuthorship, hasDisclosureTrailer, DISCLOSURE_TRAILER } from "./vendor/pipeline/disclosure.mjs";

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

function cmdReview(args) {
  const dryRun = Boolean(args["dry-run"]);
  // Local review is a convenience pre-filter; the cloud panel is authoritative.
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.warn(
      "spec-to-pr: CLAUDE_CODE_OAUTH_TOKEN not set — skipping local review " +
        "(run `claude setup-token` and export it, and `cd scripts/agent && npm ci`). " +
        "The authoritative cloud review panel still runs on green CI.",
    );
    return;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-review-"));
  const diffFile = path.join(dir, "pr.diff");
  const changedFile = path.join(dir, "changed.txt");
  const outDir = path.join(dir, ".agent-review");
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
  if (dryRun) {
    console.log(`[dry-run] would review ${diffFile} via review-panel.mjs → ${outDir}`);
    return;
  }
  try {
    execFileSync(
      "node",
      [
        path.join(HERE, "review-panel.mjs"),
        "--diff-file", diffFile,
        "--changed-files", changedFile,
        ...(baseSha ? ["--base-sha", baseSha] : []),
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
    panel = JSON.parse(execFileSync("cat", [path.join(outDir, "panel.json")], { encoding: "utf8" }));
  } catch {
    return fail("review panel produced no panel.json — treat as blocking and inspect the output above");
  }
  const blocking = panel.filter((p) => p && p.applicable !== false && p.conclusion !== "success" && p.conclusion !== "skipped");
  if (blocking.length > 0) {
    console.error(`spec-to-pr: ${blocking.length} blocking lens verdict(s): ${blocking.map((p) => p.id).join(", ")}`);
    console.error("Fix these as follow-up commits before handoff.");
    process.exit(1);
  }
  console.log("Local review panel: no blocking findings.");
}

// Only run the CLI when executed directly (not when imported for tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const args = parseArgs(process.argv, 3);
  if (cmd === "handoff") cmdHandoff(args);
  else if (cmd === "review") cmdReview(args);
  else {
    console.error("usage: spec-to-pr.mjs <handoff|review> [--slug s] [--issue NN] [--title t] [--dry-run]");
    process.exit(2);
  }
}
