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
// and staged outside the workspace (`$RUNNER_TEMP/agent-tools`), never the
// branch's own — `scripts/test/agent-workflow-guards.test.mjs` holds them to it.
//
// WHAT IT GUARANTEES
//
//   * The install stays inside the workspace. Before pnpm runs, the tree is
//     refused if a `node_modules` exists anywhere (a fresh checkout has none)
//     or if any symbolic link fails to resolve, resolves outside the workspace
//     or into its `.git`. After pnpm ran, the same is checked again, along
//     with the runner's temp directory and the directory this script was
//     staged in. Every name and link text is read as its bytes and must be
//     valid UTF-8, so each check is made on the file it names.
//   * It fetches registry packages only, by name, version and sha512
//     integrity. `pnpm-lock.yaml` is held to an allow-list
//     (install-deps-lockfile.mjs): no other kind of resolution, no local or
//     remote path, no protocol other than `workspace:`, and no way of writing
//     the file other than the plain one pnpm writes. The `package.json` of
//     every project is held to the same specifiers.
//   * It runs no lifecycle scripts and no hooks: `--ignore-scripts`,
//     `--ignore-pnpmfile`, and `--frozen-lockfile` so what is installed is what
//     the lockfile pins.
//   * The branch's pnpm configuration is not read. Every `.npmrc` in the tree is
//     set aside for the install and put back afterwards — inside the
//     container, by install-deps-container.cjs — (main's stands in when main
//     has one: `install-deps.npmrc` beside this file); the directories pnpm
//     writes to are pinned on the command line; `pnpm-workspace.yaml` must be
//     byte-identical to main's (`install-deps.workspace.yaml` beside this file);
//     and the root `package.json` may carry no `pnpm` setting outside
//     `ALLOWED_PNPM_KEYS`.
//   * pnpm runs INSIDE A CONTAINER, and the host never runs it. The container
//     is given the workspace (read-write), the workspace's `.git` (read-only
//     over it), pnpm's store directory, the pnpm the workflow installed and
//     one file of this script (both read-only) — and nothing else of the runner: not this script's
//     directory, not `$HOME`, not the job's environment, no socket, no
//     capabilities. Whatever an install does with what a manifest, a lockfile
//     or a package says, the files it can change are the workspace's own
//     working tree and its store. There is no uncontained fallback: without a
//     container runtime the install fails.
//   * Once the container has run, the runner writes nothing under the
//     workspace. Everything it does there afterwards is a read.
//   * The pnpm is the one the workflow installed, at `PNPM_VERSION`, and the
//     Node is the image's, pinned by digest. The `packageManager` field must
//     name that version and cannot select another.
//
// THE CONTAINER IS THE PRIMARY DEFENCE; THE CHECKS BEFORE IT ARE THE SECOND.
// Reading manifests and lockfiles by allow-list catches what is known to turn
// a string into a path or a command. The container is for what is not known.
//
// WHERE PNPM KEEPS ITS STORE. Under `$RUNNER_TEMP/agent-pnpm`, outside the
// workspace, named on the command line and mounted at the same path. The path
// is exported to the steps that follow (`npm_config_store_dir`, through
// `$GITHUB_ENV`), so a pnpm command the agent runs later agrees with the
// install about it.
//
// A PULL REQUEST THAT LEGITIMATELY CHANGES ANY OF THIS — the pnpm version, the
// workspace file, a `pnpm` setting in `package.json`, a dependency that is not
// a registry package — is refused here until it is merged, because the copies
// this file compares against are main's. That is intended: such a change needs
// a person, not an agent fix round, and each refusal says so.
//
// LIFECYCLE SCRIPTS ARE NOT REPLACED BY ANYTHING HERE. The workspace has two:
// the root `postinstall` (wires `.githooks`, which the agent jobs do not want)
// and the backend's (`prisma generate`). Generating the Prisma client is a build
// step of the branch like any other, so it belongs to the agent's own
// verification, not to the setup before it; the workflows' prompts tell the
// agent to run it.
//
// AUDITED AGAINST pnpm 10.5.2, which reads settings from `.npmrc`, the command
// line, the environment, the `pnpm` field of the root `package.json` and a
// fixed list of keys in `pnpm-workspace.yaml`. Later versions read more from
// the workspace file. `PNPM_VERSION` is pinned so that moving it is a decision:
// re-run the audit (docs/design/agent-pipeline/agent-install.md) when you do.
//
// Usage: node install-deps.mjs   (workspace: $GITHUB_WORKSPACE or cwd; needs $RUNNER_TEMP)

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Refusal, checkLockfile, checkProjects, readBranchFile } from "./install-deps-lockfile.mjs";

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

/**
 * The image pnpm runs in: Node 22 (22.23.5) on Debian bookworm, by digest. A
 * tag can be moved; a digest cannot. Moving it is a decision — check the Node
 * version it carries against `ci.yml`'s.
 */
export const IMAGE = "node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee";

/** The whole environment inside the container. Nothing of the job's is passed in. */
export const CONTAINER_ENV = { CI: "true", HOME: "/tmp/home" };

/** What the container runtime's own client inherits from the job: how to find and reach the daemon. */
export const DOCKER_ENV = ["PATH", "DOCKER_HOST"];

/** Where the workflow's pnpm and this script's container half are mounted inside the container. */
const PNPM_MOUNT = "/opt/pnpm";
const ENTRY_MOUNT = "/opt/install/install-deps-container.cjs";
const NPMRC_MOUNT = "/opt/install/npmrc";

/** The directory under `$RUNNER_TEMP` that holds pnpm's store and home. */
export const PNPM_DIR = "agent-pnpm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRUSTED_WORKSPACE_FILE = path.join(HERE, "install-deps.workspace.yaml");
const TRUSTED_NPMRC = path.join(HERE, "install-deps.npmrc");
const ENTRY = path.join(HERE, "install-deps-container.cjs");

const NEEDS_A_PERSON =
  "A pull request that changes this needs a person: the agent jobs compare against main's copy and will install again once the change is merged.";

const refuse = (message) => {
  throw new Refusal(message);
};

const isInside = (root, target) => target === root || target.startsWith(root + path.sep);

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * The bytes of a file name or a link's text, as a string that names exactly
 * them. Names are read as bytes, never decoded leniently: a lenient decoding
 * turns a byte sequence that is not UTF-8 into a replacement character, and
 * the string that comes back then names a DIFFERENT file — one the branch can
 * ship beside the real one, so that every check is made on it instead. Bytes
 * that are not UTF-8 are refused.
 */
function exactly(bytes, what) {
  let text;
  try {
    text = UTF8.decode(bytes);
  } catch {
    // Shown with the bytes that cannot be decoded escaped, never decoded.
    const shown = [...bytes].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`)).join("");
    return refuse(`${what(shown)} has a name that is not valid UTF-8; the install reads only names it can name exactly`);
  }
  return text;
}

/**
 * A directory's entries, each named exactly (see `exactly`). One that cannot
 * be listed is a refusal, never something to skip.
 *
 * @returns {{ name: string, isDirectory(): boolean, isFile(): boolean, isSymbolicLink(): boolean }[]}
 */
function entriesOf(root, dir) {
  let raw;
  try {
    raw = readdirSync(dir, { withFileTypes: true, encoding: "buffer" });
  } catch (error) {
    return refuse(`${path.relative(root, dir) || "the workspace"} cannot be listed (${error.code ?? error.message}); the install does not skip what it cannot read`);
  }
  return raw.map((entry) => {
    const name = exactly(entry.name, (shown) => path.join(path.relative(root, dir), shown));
    return {
      name,
      isDirectory: () => entry.isDirectory(),
      isFile: () => entry.isFile(),
      isSymbolicLink: () => entry.isSymbolicLink(),
    };
  });
}

/** The text of a symbolic link, exactly (see `exactly`). */
function linkText(file) {
  return exactly(readlinkSync(file, { encoding: "buffer" }), () => file);
}

/**
 * Where a path resolves, PHYSICALLY — the way the kernel does it: one
 * component at a time, following each symbolic link where it stands before
 * the next component is applied, so a `..` after a link goes up from where
 * the link leads and not from where it sits. (Resolving the text first and
 * the links afterwards gives a different answer for the same path.)
 *
 * @returns {string} the resolved path; throws if a component does not exist
 */
const physical = (file) => exactly(realpathSync.native(file, { encoding: "buffer" }), () => file);

/**
 * Where a symbolic link leads, judged by following its text one component at a
 * time, exactly as a later reader would: every place the path passes through,
 * and the place it ends, must be in the working tree. A target under a process
 * or device path is a different place for every process and is refused by its
 * text. The answer does not depend on who asks or from which directory.
 *
 * @returns {"special" | "outside" | "git" | "dangling" | null}
 */
function judgeLink(root, dir, full) {
  const gitDir = path.join(root, ".git");
  let missing = false;
  let hops = 0;
  /** Apply `text` from `at`; returns where it ends, or a verdict. */
  const follow = (at, text) => {
    if (++hops > 64) return "outside";
    if (path.isAbsolute(text)) {
      if (text.split("/").some((part) => part === "proc" || part === "dev" || part === "sys")) return "special";
      // An absolute target has to name the workspace itself, as written, and
      // is then followed from there like any other.
      if (text !== root && !text.startsWith(root + path.sep)) return "outside";
      at = root;
      text = text.slice(root.length);
    }
    for (const part of text.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        // Nothing can be resolved upwards from a place that is not there.
        if (missing) return "outside";
        at = path.dirname(at);
      } else if (missing) {
        at = path.join(at, part);
      } else {
        const next = path.join(at, part);
        let stat;
        try {
          stat = lstatSync(next, { throwIfNoEntry: false });
        } catch {
          return "outside";
        }
        if (!stat) {
          missing = true;
          at = next;
        } else if (stat.isSymbolicLink()) {
          let inner;
          try {
            inner = linkText(next);
          } catch {
            return "outside";
          }
          const ended = follow(at, inner);
          if (ended === "special" || ended === "outside" || ended === "git") return ended;
          at = ended;
        } else {
          at = next;
        }
      }
      if (!isInside(root, at)) return "outside";
      if (isInside(gitDir, at)) return "git";
    }
    return at;
  };
  let text;
  try {
    text = linkText(full);
  } catch {
    return "outside";
  }
  const ended = follow(dir, text);
  if (ended === "special" || ended === "outside" || ended === "git") return ended;
  if (!isInside(root, ended)) return "outside";
  if (isInside(gitDir, ended)) return "git";
  if (missing) return "dangling";
  // And the kernel's own answer, which must be the same place.
  let resolved;
  try {
    resolved = physical(full);
  } catch (error) {
    // A place whose own name cannot be named exactly is not in the working
    // tree, whose names all can.
    return error instanceof Refusal ? "outside" : "dangling";
  }
  if (resolved !== ended || !isInside(root, resolved)) return "outside";
  if (isInside(gitDir, resolved)) return "git";
  return null;
}

/**
 * Before the install, the whole checkout without following links: no
 * `node_modules`, no manifest in another format, and every symbolic link
 * leading — as written and as resolved — into the working tree.
 */
function checkTree(root) {
  const gitDir = path.join(root, ".git");
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of entriesOf(root, dir)) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (full === gitDir) continue;
      if (entry.name === "node_modules") {
        if (entry.isSymbolicLink()) {
          refuse(`${rel} is a symbolic link; the install refuses a symlinked node_modules`);
        }
        refuse(`${rel} exists before the install; the install refuses a checkout that brings its own node_modules`);
      }
      if (entry.name === "package.yaml" || entry.name === "package.json5") {
        refuse(`${rel} is a package manifest in a format the install does not read; it accepts package.json only`);
      }
      if (entry.name === ".git") refuse(`${rel} is a second .git; a workspace has one`);
      if (entry.isSymbolicLink()) {
        const problem = judgeLink(root, dir, full);
        if (problem === "special") refuse(`${rel} is a symbolic link to a process or device path`);
        if (problem === "dangling") refuse(`${rel} is a symbolic link that does not resolve`);
        if (problem === "outside") refuse(`${rel} is a symbolic link that resolves outside the workspace`);
        if (problem === "git") refuse(`${rel} is a symbolic link into the repository's .git`);
      } else if (entry.isDirectory()) {
        stack.push(full);
      }
    }
  }
}

/** The root manifest must name the pinned pnpm and set nothing outside the allow-list. */
function checkManifest(root) {
  const text = readBranchFile(path.join(root, "package.json"), "package.json at the workspace root", 1024 * 1024).toString("utf8");
  let manifest;
  try {
    manifest = JSON.parse(text);
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
  if (!existsSync(TRUSTED_WORKSPACE_FILE)) {
    refuse("install-deps.workspace.yaml is missing beside install-deps.mjs");
  }
  if (!readBranchFile(file, "pnpm-workspace.yaml at the workspace root", 1024 * 1024).equals(readFileSync(TRUSTED_WORKSPACE_FILE))) {
    refuse(
      `pnpm-workspace.yaml differs from main's; the agent jobs install only with main's workspace file, because it names the projects and carries pnpm settings. ${NEEDS_A_PERSON}`,
    );
  }
}

/** Where pnpm keeps its store and home: under the runner's temp directory, outside the workspace. */
function pnpmDirs(root) {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp || !path.isAbsolute(runnerTemp) || !existsSync(runnerTemp)) {
    refuse("RUNNER_TEMP is not set to an existing directory; the install keeps pnpm's store there");
  }
  const temp = physical(runnerTemp);
  if (isInside(root, temp) || isInside(temp, root)) {
    refuse("RUNNER_TEMP and the workspace contain one another; pnpm's store must be outside the workspace");
  }
  const base = path.join(temp, PNPM_DIR);
  const dirs = { temp, base, store: path.join(base, "store"), home: path.join(base, "home") };
  for (const dir of [dirs.base, dirs.store, dirs.home]) {
    const stat = lstatSync(dir, { throwIfNoEntry: false });
    if (!stat) mkdirSync(dir);
    else if (!stat.isDirectory()) refuse(`${dir} exists and is not a directory`);
  }
  return dirs;
}

/**
 * The environment of the container runtime's client: where to find it, how to
 * reach the daemon, and an EMPTY configuration directory — so the image is
 * pulled without any credential the runner happens to hold.
 */
export function dockerEnv(configDir, source = process.env) {
  const env = { DOCKER_CONFIG: configDir, HOME: configDir };
  for (const name of DOCKER_ENV) {
    if (source[name]) env[name] = source[name];
  }
  return env;
}

/**
 * The `docker run` that performs the install. Everything the container can
 * reach is on this command line.
 */
export function dockerArgs({ root, store, pnpmDir, uid, gid, entry = ENTRY, npmrc = null }) {
  return [
    "run",
    "--rm",
    // The default bridge: out to the registry, and not the runner's own network namespace.
    "--network=bridge",
    // The runner's own user, with no way to become another.
    `--user=${uid}:${gid}`,
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    // The image itself is read-only; scratch space is in memory.
    "--read-only",
    "--tmpfs=/tmp:rw,exec,mode=1777",
    ...Object.entries({ ...CONTAINER_ENV, ...(npmrc ? { INSTALL_DEPS_NPMRC: NPMRC_MOUNT } : {}) }).map(([name, value]) => `--env=${name}=${value}`),
    // The workspace, at the path it has on the runner, so what pnpm records
    // about it holds afterwards.
    `--volume=${root}:${root}:rw`,
    // Its `.git`, read-only over it: an install has nothing to write there.
    `--volume=${path.join(root, ".git")}:${path.join(root, ".git")}:ro`,
    `--volume=${store}:${store}:rw`,
    `--volume=${pnpmDir}:${PNPM_MOUNT}:ro`,
    // The half of this script that runs in there — that one file, read-only.
    `--volume=${entry}:${ENTRY_MOUNT}:ro`,
    ...(npmrc ? [`--volume=${npmrc}:${NPMRC_MOUNT}:ro`] : []),
    `--workdir=${root}`,
    "--entrypoint=node",
    IMAGE,
    ENTRY_MOUNT,
    `${PNPM_MOUNT}/bin/pnpm.cjs`,
    ...INSTALL_ARGS,
    `--store-dir=${store}`,
  ];
}

/** A digest of what git would act on without being asked: its hooks, its configuration, its `info`. */
function gitControlDigest(root) {
  const gitDir = path.join(root, ".git");
  const hash = createHash("sha256");
  for (const name of ["hooks", "info"]) {
    const dir = path.join(gitDir, name);
    hash.update(`${name}\0${lstatSync(dir, { throwIfNoEntry: false })?.isDirectory() ? hashTree(dir) : "absent"}\0`);
  }
  const config = path.join(gitDir, "config");
  hash.update(`config\0${lstatSync(config, { throwIfNoEntry: false })?.isFile() ? readFileSync(config).toString("base64") : "absent"}\0`);
  return hash.digest("hex");
}

/**
 * A digest of a directory: every entry's path, kind and mode, every file's
 * bytes, every link's target. Each field goes in with its length in front, so
 * two different trees cannot produce the same sequence of bytes. Nothing is
 * followed, and an entry that cannot be read is a refusal.
 *
 * @param {(rel: string, entry: import("node:fs").Dirent) => boolean} [skip] entries to leave out
 */
export function hashTree(dir, skip = () => false) {
  const hash = createHash("sha256");
  const put = (...fields) => {
    for (const field of fields) {
      const bytes = Buffer.isBuffer(field) ? field : Buffer.from(String(field), "utf8");
      hash.update(`${bytes.length}:`);
      hash.update(bytes);
    }
  };
  const walk = (rel) => {
    const entries = entriesOf(dir, path.join(dir, rel)).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const child = path.join(rel, entry.name);
      if (skip(child, entry)) continue;
      const full = path.join(dir, child);
      try {
        const mode = lstatSync(full).mode & 0o7777;
        if (entry.isSymbolicLink()) put("link", child, readlinkSync(full, { encoding: "buffer" }));
        else if (entry.isDirectory()) put("dir", child, mode);
        else if (entry.isFile()) put("file", child, mode, readFileSync(full));
        else put("other", child, mode);
      } catch (error) {
        if (error instanceof Refusal) throw error;
        refuse(`${child} cannot be read (${error.code ?? error.message}); the install does not skip what it cannot read`);
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(child);
    }
  };
  walk("");
  return hash.digest("hex");
}

/**
 * A digest of the working tree as the checkout left it: everything but `.git`
 * and the `node_modules` DIRECTORY of each project the lockfile installs for —
 * the places an install writes. Anything else named `node_modules`, a file or
 * a directory somewhere no project is, is part of the tree like any other
 * entry. Taken before and after: an install changes nothing else. Read from
 * the files themselves; no other program is asked.
 */
function workingTreeDigest(root, importers) {
  const installed = new Set(importers.map((importer) => path.normalize(path.join(importer, "node_modules"))));
  return hashTree(root, (rel, entry) => rel === ".git" || (entry.isDirectory() && installed.has(rel)));
}

/**
 * The pnpm the workflow installed: the package behind `pnpm` on PATH. It is
 * located and read, never run — the container runs it. It must be the pinned
 * version and must not be inside the workspace.
 *
 * @returns {string} the package's directory
 */
function locatePnpm(root, name) {
  let found = null;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    if (lstatSync(candidate, { throwIfNoEntry: false }) && existsSync(candidate)) {
      found = physical(candidate);
      break;
    }
  }
  if (!found) refuse(`there is no ${name} on PATH; the workflow sets pnpm ${PNPM_VERSION} up before the branch is checked out`);
  // Two layouts: the entry on PATH is a link into the package (an npm-style
  // install), or it is a launcher in a `.bin` directory beside the package
  // (how pnpm installs itself, which is what `pnpm/action-setup` does).
  const readManifest = (dir) => {
    try {
      return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
      return null;
    }
  };
  let dir = path.dirname(found);
  while (!existsSync(path.join(dir, "package.json")) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  let manifest = readManifest(dir);
  if (manifest?.name !== "pnpm" && path.basename(path.dirname(found)) === ".bin") {
    const beside = path.join(path.dirname(found), "..", "pnpm");
    if (existsSync(beside)) {
      dir = physical(beside);
      manifest = readManifest(dir);
    }
  }
  if (manifest?.name !== "pnpm" || !existsSync(path.join(dir, "bin", "pnpm.cjs"))) {
    refuse(`the ${name} on PATH is not the pnpm package the workflow installs`);
  }
  if (manifest.version !== PNPM_VERSION) {
    refuse(
      `the pnpm on PATH is ${manifest.version}; the agent jobs install with pnpm ${PNPM_VERSION}, set up by the workflow before the branch is checked out`,
    );
  }
  if (isInside(root, dir)) refuse("the pnpm on PATH is inside the workspace");
  return dir;
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
      if (!isInside(root, physical(p))) refuse(`${rel} resolves outside the workspace after the install`);
    }
    if (!existsSync(modules)) continue;
    const entries = [];
    for (const entry of entriesOf(root, modules)) {
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        for (const scoped of entriesOf(root, path.join(modules, entry.name))) {
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
        target = physical(full);
      } catch (error) {
        if (error instanceof Refusal) throw error;
        refuse(`${path.relative(root, full)} does not resolve after the install`);
      }
      if (!isInside(root, target)) {
        refuse(`${path.relative(root, full)} resolves outside the workspace after the install`);
      }
    }
  }
}

/**
 * After the install, the whole workspace again: EVERY symbolic link in it —
 * those the checkout brought as much as those the install made — leads, as
 * written and as resolved, into the working tree; there is no second `.git`;
 * and there is nothing that cannot be listed.
 */
function checkTreeAfter(root) {
  const gitDir = path.join(root, ".git");
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of entriesOf(root, dir)) {
      const full = path.join(dir, entry.name);
      if (full === gitDir) continue;
      const rel = path.relative(root, full);
      if (entry.name === ".git") refuse(`${rel} appeared during the install; a workspace has one .git`);
      if (entry.isSymbolicLink()) {
        // A link that resolves nowhere is judged by where it points as written.
        const problem = judgeLink(root, dir, full);
        if (problem !== null && problem !== "dangling") {
          refuse(`${rel} is a symbolic link out of the workspace's working tree after the install`);
        }
      } else if (entry.isDirectory()) {
        stack.push(full);
      }
    }
  }
}

/** The package managers' own configuration in the runner's home: present or not, and what it says. */
function homeConfigDigest() {
  const home = process.env.HOME;
  const hash = createHash("sha256");
  if (!home) return "no home";
  for (const name of [".npmrc", ".yarnrc", ".yarnrc.yml", ".pnpmrc", path.join(".config", "pnpm")]) {
    const file = path.join(home, name);
    const stat = lstatSync(file, { throwIfNoEntry: false });
    const state = !stat ? "absent" : stat.isSymbolicLink() ? `link ${readlinkSync(file, { encoding: "buffer" }).toString("base64")}` : stat.isDirectory() ? `dir ${hashTree(file)}` : stat.isFile() ? `file ${readFileSync(file).toString("base64")}` : "other";
    hash.update(`${name}\0${state}\0`);
  }
  return hash.digest("hex");
}

/** A directory's names as their bytes, so that two different names never compare equal. */
const listing = (dir) =>
  readdirSync(dir, { encoding: "buffer" })
    .map((name) => name.toString("hex"))
    .sort()
    .join("\n");
const siblings = (root) => listing(path.dirname(root));

/**
 * Check the workspace, install, check again.
 *
 * @param {{ workspace: string, pnpm?: string, log?: (line: string) => void }} opts
 * @returns {number} the exit status of the contained `pnpm install`
 */
export function installDeps({ workspace, pnpm = "pnpm", log = console.log }) {
  // The workspace is named plainly: an absolute path with no `..` in it that
  // is not, and does not pass through, a symbolic link.
  if (!path.isAbsolute(workspace) || workspace.split(path.sep).includes("..") || !existsSync(workspace)) {
    refuse("the workspace is not an existing absolute path without `..`");
  }
  const root = physical(workspace);
  if (root !== path.resolve(workspace)) refuse("the workspace path is, or passes through, a symbolic link");
  const dirs = pnpmDirs(root);

  // BEFORE THE INSTALL. Nothing below this block runs unless all of it passes.
  // The tree first: after it, every file read below is known not to lead
  // anywhere, and each is still read as a regular file of bounded size.
  const pnpmDir = locatePnpm(root, pnpm);
  // A real `.git` directory: it is what gets mounted read-only, so there has
  // to be one, and it has to be the directory itself.
  if (!lstatSync(path.join(root, ".git"), { throwIfNoEntry: false })?.isDirectory()) {
    refuse("the workspace's .git is missing or is not a directory; the install runs on a checkout");
  }
  if (!lstatSync(ENTRY, { throwIfNoEntry: false })?.isFile()) refuse("install-deps-container.cjs is missing beside install-deps.mjs");
  checkTree(root);
  checkManifest(root);
  checkWorkspaceFile(root);
  const lockfile = readBranchFile(path.join(root, "pnpm-lock.yaml"), "pnpm-lock.yaml at the workspace root", 64 * 1024 * 1024);
  const importers = checkLockfile(lockfile.toString("utf8"));
  checkProjects(root, importers);
  const besideBefore = siblings(root);
  const toolsBefore = hashTree(HERE);
  const gitBefore = gitControlDigest(root);
  const homeBefore = homeConfigDigest();
  const treeBefore = workingTreeDigest(root, importers);

  // THE INSTALL. From here on the runner writes NOTHING under the workspace:
  // setting the branch's `.npmrc` files aside and putting them back is done
  // inside the container, by install-deps-container.cjs. What the runner does
  // afterwards is read.
  const dockerConfig = mkdtempSync(path.join(dirs.base, "docker-config-"));
  const tempBefore = listing(dirs.temp);
  const args = dockerArgs({
    root,
    store: dirs.store,
    pnpmDir,
    uid: process.getuid(),
    gid: process.getgid(),
    npmrc: lstatSync(TRUSTED_NPMRC, { throwIfNoEntry: false })?.isFile() ? TRUSTED_NPMRC : null,
  });
  let status;
  try {
    log(`install-deps: docker ${args.join(" ")}`);
    const r = spawnSync("docker", args, { cwd: dirs.temp, stdio: "inherit", env: dockerEnv(dockerConfig) });
    if (r.error) {
      refuse(`docker could not be run (${r.error.code ?? r.error.message}); the install runs only inside a container and has no other way to run`);
    }
    status = r.status ?? 1;
  } finally {
    rmSync(dockerConfig, { recursive: true, force: true });
  }

  // AFTER THE INSTALL, whether or not pnpm succeeded. The checks above are
  // what keep it inside; this is what says so if one of them is ever wrong.
  // It looks at the places a step after this one reads from — beside the
  // workspace, the runner's temp directory, this script's own directory — and
  // not at the rest of the machine.
  if (siblings(root) !== besideBefore) {
    refuse("the install created or removed something beside the workspace");
  }
  if (listing(dirs.temp) !== tempBefore) {
    refuse("the install created or removed something in the runner's temp directory");
  }
  if (hashTree(HERE) !== toolsBefore) {
    refuse("the directory install-deps.mjs runs from changed during the install");
  }
  if (gitControlDigest(root) !== gitBefore) {
    refuse("the repository's git hooks, configuration or info changed during the install");
  }
  if (homeConfigDigest() !== homeBefore) {
    refuse("a package manager's configuration in the runner's home changed during the install");
  }
  checkTreeAfter(root);
  if (workingTreeDigest(root, importers) !== treeBefore) {
    refuse("the install changed the working tree outside node_modules");
  }
  if (status !== 0) return status;
  checkInstalled(root, importers);

  // Later pnpm commands in this job must name the same store.
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `npm_config_store_dir=${dirs.store}\n`);
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
