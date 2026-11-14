// The dependency install of the agent jobs that verify a pull request's branch.
//
// WHERE IT RUNS. `agent-fix.yml`, the `fix` job of `agent-review-panel.yml`,
// `agent-iterate-ci.yml` and `agent-review-reply.yml` check out a pull
// request's branch and need its dependencies before the agent can verify a
// change. At that point the workspace is the branch and the job already holds a
// token, so the install must not act on anything the branch wrote except as
// data: it installs exactly what the lockfile names, inside the workspace, and
// runs nothing.
//
// The jobs run THIS file from the copy of `scripts/agent` they took from `main`
// (`$RUNNER_TEMP/agent-tools`, or a side checkout of `main`), never the
// branch's own — `scripts/test/agent-workflow-guards.test.mjs` holds them to it.
//
// WHAT IT GUARANTEES
//
//   * The install stays inside the workspace. Before pnpm runs, the tree is
//     refused if a `node_modules` exists anywhere (a fresh checkout has none),
//     if any symbolic link fails to resolve, resolves outside the workspace or
//     into its `.git`, or if the lockfile names a project or a local package
//     outside the root. After pnpm ran, the same is checked again.
//   * It runs no lifecycle scripts and no hooks: `--ignore-scripts`,
//     `--ignore-pnpmfile`, and `--frozen-lockfile` so what is installed is what
//     the lockfile pins.
//   * The branch's pnpm configuration is not read. Every `.npmrc` in the tree is
//     set aside for the install and put back afterwards (main's stands in when
//     main has one: `install-deps.npmrc` beside this file); the directories pnpm
//     writes to are pinned on the command line; `pnpm-workspace.yaml` must be
//     byte-identical to main's (`install-deps.workspace.yaml` beside this file);
//     and the root `package.json` may carry no `pnpm` setting outside
//     `ALLOWED_PNPM_KEYS`.
//   * The pnpm binary is the one the workflow installed, at `PNPM_VERSION`. The
//     `packageManager` field must name that version and cannot select another.
//
// A PULL REQUEST THAT LEGITIMATELY CHANGES ANY OF THIS — the pnpm version, the
// workspace file, a `pnpm` setting in `package.json`, a new `.npmrc` — is
// refused here until it is merged, because the copies this file compares
// against are main's. That is intended: such a change needs a person, not an
// agent fix round, and each refusal says so.
//
// LIFECYCLE SCRIPTS ARE NOT REPLACED BY ANYTHING HERE. The workspace has two:
// the root `postinstall` (wires `.githooks`, which the agent jobs do not want)
// and the backend's (`prisma generate`). Generating the Prisma client is a build
// step of the branch like any other, so it belongs to the agent's own
// verification, not to the setup before it; the workflows' prompts tell the
// agent to run it.
//
// AUDITED AGAINST pnpm 10.5.2, which reads settings from `.npmrc`, the command
// line, the `pnpm` field of the root `package.json` and a fixed list of keys in
// `pnpm-workspace.yaml`. Later versions read more from the workspace file. The
// byte comparison covers that file whatever a version reads from it, but
// `PNPM_VERSION` is pinned so that moving it is a decision: re-run the audit
// (docs/design/agent-pipeline/agent-install.md) when you do.
//
// Usage: node install-deps.mjs            (workspace: $GITHUB_WORKSPACE or cwd)

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The pnpm this install was audited against. Equal to the root `packageManager`. */
export const PNPM_VERSION = "10.5.2";

/**
 * Keys the root `package.json` may carry under `pnpm`. `overrides` only changes
 * which versions resolve, and the frozen lockfile must already agree with it.
 * Every other key either does nothing with scripts off or changes what the
 * install writes, so a branch that sets one is refused.
 */
export const ALLOWED_PNPM_KEYS = ["overrides"];

/** The flags the install runs with. Exported so the tests pin them. */
export const INSTALL_ARGS = [
  "install",
  "--frozen-lockfile",
  "--ignore-scripts",
  "--ignore-pnpmfile",
  "--config.manage-package-manager-versions=false",
  "--config.modules-dir=node_modules",
  "--config.virtual-store-dir=node_modules/.pnpm",
];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRUSTED_WORKSPACE_FILE = path.join(HERE, "install-deps.workspace.yaml");
const TRUSTED_NPMRC = path.join(HERE, "install-deps.npmrc");

const NEEDS_A_PERSON =
  "A pull request that changes this needs a person: the agent jobs compare against main's copy and will install again once the change is merged.";

class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

const isInside = (root, target) => target === root || target.startsWith(root + path.sep);

/**
 * Walk the tree without following links. Refuses any `node_modules`, and any
 * symbolic link that does not resolve inside the workspace and outside `.git`.
 */
function checkTree(root) {
  const gitDir = path.join(root, ".git");
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (full === gitDir) continue;
      if (entry.name === "node_modules") {
        if (entry.isSymbolicLink()) {
          refuse(`${rel} is a symbolic link; the install refuses a symlinked node_modules`);
        }
        refuse(`${rel} exists before the install; the install refuses a checkout that brings its own node_modules`);
      }
      if (entry.isSymbolicLink()) {
        let target;
        try {
          target = realpathSync(full);
        } catch {
          refuse(`${rel} is a symbolic link that does not resolve`);
        }
        if (!isInside(root, target)) {
          refuse(`${rel} is a symbolic link that resolves outside the workspace`);
        }
        if (isInside(gitDir, target)) {
          refuse(`${rel} is a symbolic link into the repository's .git`);
        }
      } else if (entry.isDirectory()) {
        stack.push(full);
      }
    }
  }
}

/** The root manifest must name the pinned pnpm and set nothing outside the allow-list. */
function checkManifest(root) {
  const file = path.join(root, "package.json");
  if (!existsSync(file)) refuse("package.json is missing at the workspace root");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    refuse("package.json at the workspace root is not valid JSON");
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    refuse("package.json at the workspace root is not an object");
  }
  if (manifest.packageManager !== `pnpm@${PNPM_VERSION}`) {
    refuse(
      `package.json names packageManager ${JSON.stringify(manifest.packageManager)}; the agent jobs install with pnpm@${PNPM_VERSION} only. ${NEEDS_A_PERSON}`,
    );
  }
  const settings = manifest.pnpm;
  if (settings === undefined) return;
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    refuse('the "pnpm" field of package.json is not an object');
  }
  const extra = Object.keys(settings).filter((key) => !ALLOWED_PNPM_KEYS.includes(key));
  if (extra.length > 0) {
    refuse(
      `package.json sets pnpm.${extra.join(", pnpm.")}; the agent jobs install only with the pnpm settings main carries (${ALLOWED_PNPM_KEYS.join(", ")}). ${NEEDS_A_PERSON}`,
    );
  }
}

/** The workspace file decides which projects are installed and, in pnpm 10, settings. */
function checkWorkspaceFile(root) {
  const file = path.join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) refuse("pnpm-workspace.yaml is missing at the workspace root");
  if (!lstatSync(file).isFile()) refuse("pnpm-workspace.yaml is not a regular file");
  if (!existsSync(TRUSTED_WORKSPACE_FILE)) {
    refuse("install-deps.workspace.yaml is missing beside install-deps.mjs");
  }
  if (!readFileSync(file).equals(readFileSync(TRUSTED_WORKSPACE_FILE))) {
    refuse(
      `pnpm-workspace.yaml differs from main's; the agent jobs install only with main's workspace file, because it names the projects and carries pnpm settings. ${NEEDS_A_PERSON}`,
    );
  }
}

/**
 * The lockfile names the projects it installs for and any local package it
 * links or copies. Each must be a plain path under the workspace root. Read
 * line by line, so the file must also stay in the plain form pnpm writes:
 * no escapes, anchors, aliases or tags that could spell a path another way.
 *
 * @returns {string[]} the importers, relative to the root
 */
export function checkLockfile(root, text) {
  const lines = text.split("\n");
  if (text.includes("\\")) {
    refuse("pnpm-lock.yaml contains a backslash; the install reads only the plain form pnpm writes");
  }
  const importers = [];
  let section = "";
  let importer = ".";
  for (const line of lines) {
    if (/^\s*(#|$)/.test(line)) continue;
    if (/(^|[\s,[{:])[&!][^\s]/.test(line) || /(^|[\s,[{]|:\s)\*[^\s'*]/.test(line)) {
      refuse("pnpm-lock.yaml uses a YAML anchor, alias or tag; the install reads only the plain form pnpm writes");
    }
    if (/^\S/.test(line)) {
      section = line.replace(/:.*$/, "");
      if (section === "importers" && line.trim() !== "importers:") {
        refuse("pnpm-lock.yaml does not list its importers in block form");
      }
      importer = ".";
      continue;
    }
    if (section === "importers") {
      const key = /^ {2}(\S.*?):(?:\s*\{\s*\})?\s*$/.exec(line);
      if (key) {
        let name = key[1];
        if (/^'.*'$/.test(name)) name = name.slice(1, -1);
        if (!/^(\.|[A-Za-z0-9@_][A-Za-z0-9@_./-]*)$/.test(name) || name.split("/").includes("..")) {
          refuse(`pnpm-lock.yaml names a project that is not a plain path under the workspace root: ${name}`);
        }
        importer = name;
        importers.push(name);
        continue;
      }
      if (/^ {2}\S/.test(line)) {
        refuse(`pnpm-lock.yaml has an importer entry the install cannot read: ${line.trim()}`);
      }
    }
    // Local packages: `link:` is relative to the importer; `file:` and
    // `directory:` are checked against both the importer and the root, so
    // whichever one pnpm resolves them from, they stay inside.
    const local = /(?:^|[\s'"{,@(])(link|file):([^\s'",})]+)|(directory):\s*([^\s,}]+)/g;
    for (const match of line.matchAll(local)) {
      const kind = match[1] ?? match[3];
      const target = (match[2] ?? match[4]).replace(/:$/, "");
      const bases = kind === "link" ? [importer] : [importer, "."];
      for (const base of bases) {
        const resolved = path.resolve(root, base, target);
        if (path.isAbsolute(target) || !isInside(root, resolved)) {
          refuse(`pnpm-lock.yaml names a local package outside the workspace root: ${kind}:${target}`);
        }
      }
    }
  }
  if (importers.length === 0) refuse("pnpm-lock.yaml lists no importers");
  return importers;
}

/** The pnpm on PATH, asked from an empty directory so no project file can answer for it. */
function checkPnpmVersion(pnpm) {
  const neutral = mkdtempSync(path.join(os.tmpdir(), "install-deps-pnpm-"));
  try {
    const r = spawnSync(pnpm, ["--version"], {
      cwd: neutral,
      encoding: "utf8",
      env: { ...process.env, npm_config_manage_package_manager_versions: "false" },
    });
    const version = (r.stdout ?? "").trim();
    if (r.status !== 0 || version !== PNPM_VERSION) {
      refuse(
        `the pnpm on PATH is ${version || "not runnable"}; the agent jobs install with pnpm ${PNPM_VERSION}, set up by the workflow before the branch is checked out`,
      );
    }
  } finally {
    rmSync(neutral, { recursive: true, force: true });
  }
}

/** Every `.npmrc` in the tree (file or directory), relative to the root. */
function findNpmrc(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name === ".npmrc") found.push(path.relative(root, full));
      else if (entry.isDirectory() && !(dir === root && entry.name === ".git")) stack.push(full);
    }
  }
  return found;
}

/** After the install: every project's `node_modules` is a real directory whose entries stay inside. */
function checkInstalled(root, importers) {
  for (const importer of importers) {
    const dir = path.join(root, importer);
    if (!existsSync(dir)) continue;
    const modules = path.join(dir, "node_modules");
    for (const p of [dir, modules]) {
      if (!existsSync(p)) continue;
      const rel = path.relative(root, p) || ".";
      if (lstatSync(p).isSymbolicLink()) refuse(`${rel} is a symbolic link after the install`);
      if (!isInside(root, realpathSync(p))) refuse(`${rel} resolves outside the workspace after the install`);
    }
    if (!existsSync(modules)) continue;
    const entries = [];
    for (const entry of readdirSync(modules, { withFileTypes: true })) {
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        for (const scoped of readdirSync(path.join(modules, entry.name), { withFileTypes: true })) {
          entries.push([path.join(entry.name, scoped.name), scoped]);
        }
      } else {
        entries.push([entry.name, entry]);
      }
    }
    for (const [name, entry] of entries) {
      if (!entry.isSymbolicLink()) continue;
      const full = path.join(modules, name);
      let target;
      try {
        target = realpathSync(full);
      } catch {
        refuse(`${path.relative(root, full)} does not resolve after the install`);
      }
      if (!isInside(root, target)) {
        refuse(`${path.relative(root, full)} resolves outside the workspace after the install`);
      }
    }
  }
}

/** Move a file or directory, also across filesystems. */
function move(from, to) {
  try {
    renameSync(from, to);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

const siblings = (root) => readdirSync(path.dirname(root)).sort().join("\n");

/**
 * Check the workspace, install, check again.
 *
 * @param {{ workspace: string, pnpm?: string, log?: (line: string) => void }} opts
 * @returns {number} the exit status of `pnpm install`
 */
export function installDeps({ workspace, pnpm = "pnpm", log = console.log }) {
  const root = realpathSync(workspace);

  // BEFORE THE INSTALL. Nothing below this block runs unless all of it passes.
  checkPnpmVersion(pnpm);
  checkManifest(root);
  checkWorkspaceFile(root);
  checkTree(root);
  const lockfile = path.join(root, "pnpm-lock.yaml");
  if (!existsSync(lockfile)) refuse("pnpm-lock.yaml is missing at the workspace root");
  const importers = checkLockfile(root, readFileSync(lockfile, "utf8"));
  const besideBefore = siblings(root);

  // The branch's `.npmrc` files step aside for the install and come back
  // afterwards, so the agent's working tree is what the branch holds.
  // The stash is outside the workspace, on the runner's own temp directory.
  const runnerTemp = process.env.RUNNER_TEMP;
  const stash = mkdtempSync(path.join(runnerTemp && existsSync(runnerTemp) ? runnerTemp : os.tmpdir(), "install-deps-npmrc-"));
  const setAside = findNpmrc(root);
  let status;
  try {
    for (const rel of setAside) {
      mkdirSync(path.dirname(path.join(stash, rel)), { recursive: true });
      move(path.join(root, rel), path.join(stash, rel));
    }
    if (setAside.length > 0) log(`install-deps: set aside ${setAside.length} .npmrc for the install`);
    if (existsSync(TRUSTED_NPMRC)) cpSync(TRUSTED_NPMRC, path.join(root, ".npmrc"));
    log(`install-deps: pnpm ${INSTALL_ARGS.join(" ")}`);
    const r = spawnSync(pnpm, INSTALL_ARGS, { cwd: root, stdio: "inherit" });
    status = r.status ?? 1;
  } finally {
    rmSync(path.join(root, ".npmrc"), { recursive: true, force: true });
    for (const rel of setAside) move(path.join(stash, rel), path.join(root, rel));
    rmSync(stash, { recursive: true, force: true });
  }
  if (status !== 0) return status;

  // AFTER THE INSTALL. The checks above are what keep it inside; this is what
  // says so if one of them is ever wrong.
  checkInstalled(root, importers);
  if (siblings(root) !== besideBefore) {
    refuse("the install created or removed something beside the workspace");
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = installDeps({ workspace: process.env.GITHUB_WORKSPACE || process.cwd() });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(`::error::install-deps: ${error.message}`);
    process.exitCode = 1;
  }
}
