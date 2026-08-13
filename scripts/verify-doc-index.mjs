// Assert every package, design doc, and script on disk is reachable from the
// index file that is supposed to introduce it.
//
// WHY THIS DIRECTION. `verify-entropy.mjs` already walks the other way — for
// each link in `docs/design/*.md` it checks the target exists — which catches a
// file that moved or was deleted. It cannot catch the far more common rot: a
// file that was ADDED and never indexed. Nothing referenced it, so there is no
// broken reference to find. That is exactly how `packages/README.md` came to be
// missing four of eleven packages while every link in it still resolved.
//
// The two checks are complements and must not be merged: dead links are about
// the index's claims, coverage is about its silences.
//
// SCOPE IS THE TOP LEVEL, deliberately. `scripts/agent/` alone holds over a
// hundred files; demanding a row per file would produce an index nobody
// maintains and a gate everyone learns to route around. A directory is covered
// once the index names it — what is inside it is that directory's own README's
// problem.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "[verify:doc-index]";

/**
 * The link targets in a markdown document, as written.
 *
 * Fenced code blocks are skipped: an index that shows an example row inside a
 * fence is documenting its own format, and counting that as coverage would let
 * a document satisfy this gate by describing itself. External links and bare
 * anchors are dropped — neither can point at a path in this repository.
 */
export function linkedTargets(content) {
  const targets = new Set();
  let inFence = false;

  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].split("#")[0];
      if (!target) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, …
      targets.add(target);
    }
  }

  return targets;
}

/** Normalize a link target to a repo-relative path, or null if it escapes. */
function resolveTarget(target, indexDir, root) {
  const abs = path.resolve(root, indexDir, target);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/**
 * Is `entry` linked from the index, directly or through an ancestor directory?
 *
 * The ancestor rule is what lets one umbrella row cover a subtree —
 * `docs/design/README.md` links `docs/tables/` once and the per-feature docs
 * beneath it are covered. The alternative was an exception list in this file,
 * which would rot the moment someone reorganized the directory it names.
 */
function isCovered(entry, links) {
  if (links.has(entry)) return true;
  const parts = entry.split("/");
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join("/");
    if (links.has(ancestor) || links.has(`${ancestor}/`)) return true;
  }
  return false;
}

/**
 * Is any link at or below `dir`?
 *
 * The rule for a directory-shaped entry, where `isCovered` reads the wrong way
 * round: a package is introduced by linking INTO it — `[sheets](sheets/README.md)`
 * — not by linking one of its ancestors.
 */
function isLinkedInto(dir, links) {
  for (const link of links) {
    if (link === dir || link.startsWith(`${dir}/`)) return true;
  }
  return false;
}

function readIndex(root, indexPath) {
  const abs = path.resolve(root, indexPath);
  if (!existsSync(abs)) return null;
  const content = readFileSync(abs, "utf8");
  const indexDir = path.dirname(indexPath);
  const links = new Set();
  for (const target of linkedTargets(content)) {
    const rel = resolveTarget(target, indexDir, root);
    if (rel !== null) links.add(rel);
  }
  return { content, links };
}

function listDir(root, rel) {
  const abs = path.resolve(root, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every `.md` file under `dir`, repo-relative, `node_modules` pruned. */
function markdownFiles(root, dir, out = []) {
  for (const entry of listDir(root, dir)) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      markdownFiles(root, rel, out);
    } else if (entry.name.endsWith(".md")) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Does the scripts index name `entry`?
 *
 * A mention, not a link — that index is a table of names, and requiring links
 * would mean linking a `.mjs` file from markdown for no reader's benefit. The
 * boundary assertion is load-bearing: a plain `includes` would let
 * `verify-integration-docker.mjs` satisfy `verify-integration.mjs`, silently
 * exempting whichever name is a prefix of another.
 */
function mentions(content, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w.-])${escaped}(?![\\w.-])`).test(content);
}

/**
 * Every coverage gap in `root`, as human-readable findings.
 *
 * Exported and pure over a directory so the suite can run it against a planted
 * tree — the only way to test that a MISSING entry is caught.
 */
export function collectFindings(root) {
  const findings = [];

  // Packages. A directory is a package when it has a manifest; that also skips
  // `node_modules` and stray build output without naming either.
  const packagesIndex = readIndex(root, "packages/README.md");
  if (!packagesIndex) {
    findings.push("packages/README.md is missing");
  } else {
    for (const entry of listDir(root, "packages")) {
      if (!entry.isDirectory()) continue;
      const rel = `packages/${entry.name}`;
      if (!existsSync(path.resolve(root, rel, "package.json"))) continue;
      if (!isLinkedInto(rel, packagesIndex.links)) {
        findings.push(
          `packages/README.md does not link ${rel} (add a row, or link the directory)`,
        );
      }
    }
  }

  // Design docs.
  const designIndex = readIndex(root, "docs/design/README.md");
  if (!designIndex) {
    findings.push("docs/design/README.md is missing");
  } else {
    for (const file of markdownFiles(root, "docs/design")) {
      if (file === "docs/design/README.md") continue;
      if (!isCovered(file, designIndex.links)) {
        findings.push(
          `docs/design/README.md does not link ${file} (add a row, or link its directory)`,
        );
      }
    }
  }

  // Scripts — top level only, by mention rather than by link.
  const scriptsIndex = readIndex(root, "scripts/README.md");
  if (!scriptsIndex) {
    findings.push("scripts/README.md is missing");
  } else {
    for (const entry of listDir(root, "scripts")) {
      if (entry.name === "README.md" || entry.name === "node_modules") continue;
      // A directory is reported with a trailing slash for the reader, but
      // matched without one — an index may write `agent/`, `[`agent/`](agent/)`
      // or just `agent`, and all three name it.
      const name = entry.isDirectory() ? `${entry.name}/` : entry.name;
      if (!mentions(scriptsIndex.content, entry.name)) {
        findings.push(`scripts/README.md does not mention \`${name}\``);
      }
    }
  }

  return findings;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const repoRoot = path.resolve(scriptDir, "..");
  const findings = collectFindings(repoRoot);
  if (findings.length === 0) {
    console.log(`${PREFIX} Every package, design doc, and script is indexed.`);
  } else {
    for (const finding of findings) console.log(`${PREFIX}   ${finding}`);
    console.log(`${PREFIX} ${findings.length} unindexed entries found.`);
    process.exit(1);
  }
}
