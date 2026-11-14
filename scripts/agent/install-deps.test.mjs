// `install-deps.mjs` is the dependency install of the agent jobs that hold a
// token while a pull request's branch is in the workspace. These tests RUN it —
// against small trees under the OS temp directory — rather than read it: for every
// refusal, with the container runtime replaced by a stub that records whether
// it was reached; and for one install with the real runtime and the real pnpm,
// which proves what the stub can only record.
//
// The pins at the bottom compare the copies shipped beside the script with the
// repository's own files, and hold the repository's own lockfile to the
// allow-list, so a pull request that changes one without the other fails here.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  lstatSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_PNPM_KEYS, CONTAINER_ENV, DOCKER_ENV, IMAGE, INSTALL_ARGS, PNPM_DIR, PNPM_VERSION, dockerArgs, hashTree } from "./install-deps.mjs";
import { MANIFEST_KEYS, Refusal, checkLockfile, isAllowedSpecifier, parseStrictYaml } from "./install-deps-lockfile.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SCRIPT = path.join(HERE, "install-deps.mjs");
const ENTRY = path.join(HERE, "install-deps-container.cjs");
const SHIPPED = ["install-deps.mjs", "install-deps-lockfile.mjs", "install-deps-container.cjs", "install-deps.workspace.yaml", "install-deps.npmrc"];
const TRUSTED_WORKSPACE = readFileSync(path.join(HERE, "install-deps.workspace.yaml"), "utf8");
const TMP = realpathSync(os.tmpdir());

const INTEGRITY = `sha512-${"A".repeat(86)}==`;
const MANIFESTS = {
  ".": { name: "root", private: true, packageManager: `pnpm@${PNPM_VERSION}`, devDependencies: { a: "workspace:*", dep: "^1.0.0" } },
  "packages/a": { name: "a", version: "1.0.0", dependencies: { b: "workspace:*" } },
  "packages/b": { name: "b", version: "1.0.0" },
};
const HEAD = "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\n";
const PROJECTS =
  "  packages/a:\n    dependencies:\n      b:\n        specifier: workspace:*\n        version: link:../b\n\n" + "  packages/b: {}\n";
const LINK_A = "      a:\n        specifier: workspace:*\n        version: link:packages/a\n";
/** A lockfile of workspace projects only: what the real pnpm can install offline. */
const WORKSPACE_LOCKFILE = `${HEAD}importers:\n\n  .:\n    devDependencies:\n${LINK_A}\n${PROJECTS}`;
/** The same with one registry package, as pnpm writes it. */
const LOCKFILE =
  `${HEAD}importers:\n\n  .:\n    devDependencies:\n${LINK_A}      dep:\n        specifier: ^1.0.0\n        version: 1.0.0\n\n${PROJECTS}\n` +
  `packages:\n\n  dep@1.0.0:\n    resolution: {integrity: ${INTEGRITY}}\n    engines: {node: '>=18'}\n\n` +
  "snapshots:\n\n  dep@1.0.0: {}\n";
const RESOLUTION = `    resolution: {integrity: ${INTEGRITY}}\n`;

const GIT = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();

/**
 * Remove a temporary tree, reading every name as bytes: some cases leave
 * names that are not UTF-8, which a removal by decoded name cannot reach.
 */
function removeTree(dir) {
  const target = Buffer.isBuffer(dir) ? dir : Buffer.from(dir);
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isDirectory()) {
    chmodSync(target, 0o700);
    for (const name of readdirSync(target, { encoding: "buffer" })) {
      removeTree(Buffer.concat([target, Buffer.from("/"), name]));
    }
    rmdirSync(target);
  } else {
    unlinkSync(target);
  }
}

/**
 * A path whose last component is `name` followed by raw bytes — bytes that
 * are not UTF-8 unless `bytes` says otherwise.
 */
const rawPath = (dir, name, bytes = [0xff]) => Buffer.concat([Buffer.from(path.join(dir, name)), Buffer.from(bytes)]);
const REPLACEMENT = "�";

/** Whether this filesystem takes a file name that is not UTF-8 (ext4 does; APFS does not). */
const NON_UTF8_NAMES = (() => {
  const dir = mkdtempSync(path.join(TMP, "install-deps-names-"));
  try {
    writeFileSync(rawPath(dir, "probe"), "");
    return true;
  } catch {
    return false;
  } finally {
    removeTree(dir);
  }
})();
const NEEDS_NON_UTF8 = "needs a filesystem that takes file names that are not UTF-8 (ext4 does, APFS does not); runs in the Linux lane";

/**
 * A temp area with, per case, a workspace, a runner temp directory, a pnpm
 * package on PATH (located and read by the script, never run) and a stub
 * `docker`.
 */
function harness(t) {
  const base = mkdtempSync(path.join(TMP, "install-deps-test-"));
  t.after(() => {
    // Some cases close a directory or leave a name that is not UTF-8.
    removeTree(base);
  });
  // The stub is told what to do through a file beside it: the script hands
  // the runtime's client an environment of its own, so nothing set here
  // reaches it. It says it ran, records its arguments, its environment and
  // the `.npmrc` in the directory it was told to work in, makes the directory
  // an install makes, and does whatever the case asks.
  const DOCKER_STUB = [
    "#!/bin/sh",
    '. "${0%/*}/stub.conf"',
    'echo "$*" > "$STUB_RAN"',
    // Before its own PATH is widened: what it was handed.
    '/usr/bin/env > "$STUB_RAN.env"',
    'PATH="$PATH:/usr/bin:/bin"',
    'for a in "$@"; do case "$a" in --workdir=*) cd "${a#--workdir=}";; esac; done',
    'if [ -e .npmrc ]; then cat .npmrc > "$STUB_RAN.npmrc"; fi',
    'ls -A "$DOCKER_CONFIG" > "$STUB_RAN.config" 2>&1',
    "mkdir -p node_modules",
    'eval "$STUB_EXTRA"',
    'exit "$STUB_EXIT"',
    "",
  ].join("\n");
  const outside = path.join(base, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "keep"), "keep");

  let n = 0;
  /**
   * Run the script on a fresh tree; `setup` shapes it first.
   * `stub` configures the stub, `env` is added to the script's environment,
   * `staged` runs a copy of the script from the runner temp directory,
   * `pnpmVersion` is the version of the pnpm package on PATH, `docker: false`
   * leaves no `docker` on PATH, `launcher` puts pnpm on PATH the way pnpm
   * installs itself: a launcher script in a `.bin` beside the package.
   */
  const run = (setup, { stub = {}, env = {}, staged = false, pnpmVersion = PNPM_VERSION, docker = true, launcher = false } = {}) => {
    const area = path.join(base, `case${++n}`);
    // The workspace sits in a directory of its own, so that anything appearing
    // beside it is the install's doing.
    const dir = path.join(area, "work", "ws");
    const rt = path.join(area, "rt");
    const home = path.join(area, "home");
    const bin = path.join(area, "bin");
    const pnpmDir = path.join(area, "pnpm-package");
    for (const d of [rt, home, bin, path.join(pnpmDir, "bin")]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(pnpmDir, "package.json"), JSON.stringify({ name: "pnpm", version: pnpmVersion }));
    writeFileSync(path.join(pnpmDir, "bin", "pnpm.cjs"), "throw new Error('the host must not run pnpm');\n");
    let PATH = bin;
    if (launcher) {
      const modules = path.join(area, "setup-pnpm", "node_modules");
      mkdirSync(path.join(modules, ".bin"), { recursive: true });
      symlinkSync(pnpmDir, path.join(modules, "pnpm"));
      writeFileSync(path.join(modules, ".bin", "pnpm"), '#!/bin/sh\nexec node "$(dirname "$0")/../pnpm/bin/pnpm.cjs" "$@"\n', { mode: 0o755 });
      PATH = `${path.join(modules, ".bin")}${path.delimiter}${bin}`;
    } else {
      symlinkSync(path.join(pnpmDir, "bin", "pnpm.cjs"), path.join(bin, "pnpm"));
    }
    if (docker) {
      writeFileSync(path.join(bin, "docker"), DOCKER_STUB);
      chmodSync(path.join(bin, "docker"), 0o755);
    }
    for (const [project, manifest] of Object.entries(MANIFESTS)) {
      mkdirSync(path.join(dir, project), { recursive: true });
      writeFileSync(path.join(dir, project, "package.json"), JSON.stringify(manifest));
    }
    // What a checkout has in `.git` that the install looks at.
    mkdirSync(path.join(dir, ".git", "hooks"), { recursive: true });
    mkdirSync(path.join(dir, ".git", "info"));
    writeFileSync(path.join(dir, ".git", "config"), "[core]\n");
    writeFileSync(path.join(dir, ".git", "info", "exclude"), "");
    writeFileSync(path.join(dir, "pnpm-workspace.yaml"), TRUSTED_WORKSPACE);
    writeFileSync(path.join(dir, "pnpm-lock.yaml"), LOCKFILE);
    setup?.(dir);
    const ran = path.join(area, "ran");
    const conf = { STUB_RAN: ran, STUB_EXTRA: ":", STUB_EXIT: "0", STUB_RT: rt, STUB_HOME: home, ...stub };
    writeFileSync(path.join(bin, "stub.conf"), Object.entries(conf).map(([k, v]) => `${k}='${v}'\n`).join(""));
    let script = SCRIPT;
    if (staged) {
      mkdirSync(path.join(rt, "agent-tools"));
      for (const f of SHIPPED) {
        if (existsSync(path.join(HERE, f))) cpSync(path.join(HERE, f), path.join(rt, "agent-tools", f));
      }
      script = path.join(rt, "agent-tools", "install-deps.mjs");
    }
    const githubEnv = path.join(area, "github-env");
    const r = spawnSync(process.execPath, [script], {
      cwd: dir,
      encoding: "utf8",
      // PATH holds this case's pnpm and docker and nothing else, so a case
      // without a docker has none — and the script asks no other program.
      env: { PATH, HOME: home, GITHUB_WORKSPACE: dir, RUNNER_TEMP: rt, GITHUB_ENV: githubEnv, ...env },
    });
    return { dir, rt, home, pnpmDir, status: r.status, out: r.stdout, err: r.stderr, installed: existsSync(ran), ran, githubEnv };
  };
  return { base, outside, run };
}

const setManifest = (dir, change, project = ".") => {
  const manifest = structuredClone(MANIFESTS[project]);
  change(manifest);
  writeFileSync(path.join(dir, project, "package.json"), JSON.stringify(manifest));
};
const setLockfile = (dir, from, to) => {
  assert.ok(LOCKFILE.includes(from), `the fixture lockfile has no ${JSON.stringify(from)}`);
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), LOCKFILE.replace(from, to));
};

test("an ordinary tree installs: in a container, with nothing of the job's environment, and the runner leaves the branch's .npmrc alone", (t) => {
  const { run } = harness(t);
  const ok = run(
    (dir) => {
      writeFileSync(path.join(dir, ".npmrc"), "branch=1\n");
      writeFileSync(path.join(dir, "packages", "a", ".npmrc"), "nested=1\n");
      // A directory of that name is set aside and put back as well.
      mkdirSync(path.join(dir, "packages", "b", ".npmrc"));
      writeFileSync(path.join(dir, "packages", "b", ".npmrc", "inner"), "x");
      // Links that stay inside the workspace are not refused: a plain one, one
      // through another, one that goes up and comes down inside.
      symlinkSync("pnpm-lock.yaml", path.join(dir, "alias"));
      assert.equal(spawnSync("sh", ["-c", INSIDE_LINKS], { cwd: dir }).status, 0);
      // `overrides` is the one pnpm setting main carries.
      setManifest(dir, (m) => {
        m.pnpm = { overrides: { "x@<1": "1.0.0" } };
      });
    },
    {
      // Settings and credentials in the job's environment do not reach pnpm.
      env: {
        npm_config_store_dir: "/elsewhere",
        NPM_CONFIG_REGISTRY: "https://example.invalid/",
        npm_config_ignore_scripts: "false",
        PNPM_HOME: "/elsewhere",
        DOCKER_CONFIG: "/elsewhere",
        COREPACK_HOME: "/elsewhere",
        NODE_OPTIONS: "--no-warnings",
        GH_TOKEN: "not-for-pnpm",
        GITHUB_TOKEN: "not-for-pnpm",
      },
    },
  );
  assert.equal(ok.status, 0, ok.err);
  assert.equal(ok.installed, true);
  const store = path.join(ok.rt, PNPM_DIR, "store");
  assert.equal(
    readFileSync(ok.ran, "utf8").trim(),
    dockerArgs({ root: ok.dir, store, pnpmDir: ok.pnpmDir, uid: process.getuid(), gid: process.getgid() }).join(" "),
  );

  const env = Object.fromEntries(
    readFileSync(`${ok.ran}.env`, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const shellOwn = ["PWD", "OLDPWD", "SHLVL", "_", "__CF_USER_TEXT_ENCODING"];
  const unexpected = Object.keys(env).filter((k) => ![...DOCKER_ENV, "DOCKER_CONFIG", "HOME", ...shellOwn].includes(k) && !k.startsWith("STUB_"));
  assert.deepEqual(unexpected, [], "the container runtime was handed more of the job's environment than the allow-list");
  assert.ok(env.HOME && env.PATH, "the stub recorded no environment");
  // The runtime's client is given an empty configuration directory of its own
  // — no credential of the runner's for the pull — and it is gone afterwards.
  assert.equal(env.HOME, env.DOCKER_CONFIG);
  assert.notEqual(env.HOME, ok.home);
  assert.ok(env.DOCKER_CONFIG.startsWith(path.join(ok.rt, PNPM_DIR) + path.sep));
  assert.equal(readFileSync(`${ok.ran}.config`, "utf8"), "");
  assert.equal(existsSync(env.DOCKER_CONFIG), false);

  // The steps after this one are told where the store is.
  assert.equal(readFileSync(ok.githubEnv, "utf8"), `npm_config_store_dir=${store}\n`);
  // The runner itself does not touch the branch's `.npmrc` files: setting them
  // aside is the container's half (install-deps-container.cjs, tested below).
  assert.equal(readFileSync(`${ok.ran}.npmrc`, "utf8"), "branch=1\n");
  assert.equal(readFileSync(path.join(ok.dir, ".npmrc"), "utf8"), "branch=1\n");
  assert.equal(readFileSync(path.join(ok.dir, "packages", "a", ".npmrc"), "utf8"), "nested=1\n");
  assert.equal(readFileSync(path.join(ok.dir, "packages", "b", ".npmrc", "inner"), "utf8"), "x");
  assert.deepEqual(readdirSync(ok.rt), [PNPM_DIR]);
  assert.deepEqual(readdirSync(path.join(ok.rt, PNPM_DIR)).sort(), ["home", "store"]);

  // pnpm installed the way pnpm installs itself — a launcher in `.bin`, the
  // package beside it — is found as well: that is what the workflow's setup
  // action leaves on PATH.
  const launched = run(null, { launcher: true });
  assert.equal(launched.status, 0, launched.err);
  assert.ok(readFileSync(launched.ran, "utf8").includes(`--volume=${launched.pnpmDir}:/opt/pnpm:ro`), "the launcher layout was not resolved to the package");
});

test("the flags the install runs with are the hardened ones", () => {
  assert.equal(INSTALL_ARGS[0], "install");
  for (const flag of [
    "--frozen-lockfile",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--config.manage-package-manager-versions=false",
    "--config.modules-dir=node_modules",
    "--config.virtual-store-dir=node_modules/.pnpm",
  ]) {
    assert.ok(INSTALL_ARGS.includes(flag), `the install lost ${flag}`);
  }
});

test("the container is given the workspace, its store and the workflow's pnpm, and nothing else", () => {
  const args = dockerArgs({ root: "/w/ws", store: "/t/agent-pnpm/store", pnpmDir: "/h/pnpm", uid: 1001, gid: 118, entry: "/t/agent-tools/install-deps-container.cjs" });
  assert.equal(args[0], "run");
  // Everything of the host the container can reach: five mounts, three of them read-only.
  assert.deepEqual(
    args.filter((a) => a.startsWith("--volume=") || a.startsWith("-v") || a.startsWith("--mount")),
    [
      "--volume=/w/ws:/w/ws:rw",
      "--volume=/w/ws/.git:/w/ws/.git:ro",
      "--volume=/t/agent-pnpm/store:/t/agent-pnpm/store:rw",
      "--volume=/h/pnpm:/opt/pnpm:ro",
      "--volume=/t/agent-tools/install-deps-container.cjs:/opt/install/install-deps-container.cjs:ro",
    ],
  );
  // Main's own `.npmrc`, when there is one, is a sixth, read-only, and named to the container half.
  const withNpmrc = dockerArgs({ root: "/w/ws", store: "/s", pnpmDir: "/h/pnpm", uid: 1, gid: 1, entry: "/e.cjs", npmrc: "/t/agent-tools/install-deps.npmrc" });
  assert.ok(withNpmrc.includes("--volume=/t/agent-tools/install-deps.npmrc:/opt/install/npmrc:ro"));
  assert.ok(withNpmrc.includes("--env=INSTALL_DEPS_NPMRC=/opt/install/npmrc"));
  // Everything in its environment.
  assert.deepEqual(
    args.filter((a) => a.startsWith("--env") || a === "-e"),
    Object.entries(CONTAINER_ENV).map(([k, v]) => `--env=${k}=${v}`),
  );
  assert.deepEqual(CONTAINER_ENV, { CI: "true", HOME: "/tmp/home" });
  for (const flag of ["--rm", "--network=bridge", "--user=1001:118", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only", "--workdir=/w/ws", "--entrypoint=node"]) {
    assert.ok(args.includes(flag), `the container lost ${flag}`);
  }
  for (const a of args) {
    assert.doesNotMatch(a, /^--(privileged|pid|ipc|userns|cap-add|device|env-file|volumes-from|network=host|net=host)/, `the container gained ${a}`);
    assert.doesNotMatch(a, /docker\.sock/, "the container was given the runtime's socket");
  }
  // The image is named by digest, and what runs in it is the mounted pnpm with the hardened flags.
  const at = args.indexOf(IMAGE);
  assert.match(IMAGE, /^node:22-bookworm-slim@sha256:[0-9a-f]{64}$/);
  assert.deepEqual(args.slice(at + 1), ["/opt/install/install-deps-container.cjs", "/opt/pnpm/bin/pnpm.cjs", ...INSTALL_ARGS, "--store-dir=/t/agent-pnpm/store"]);
  // What the runtime's client inherits is where it is and how to reach the daemon, nothing more.
  assert.deepEqual([...DOCKER_ENV].sort(), ["DOCKER_HOST", "PATH"]);
});

/**
 * LINKS THAT READ ONE WAY AND RESOLVE ANOTHER. `p/q/up` leads to the directory
 * two above it. A path that goes through it and then `..` is, read as text, a
 * path under `p/` — where a directory of the right name is waiting — and,
 * followed the way a file is actually opened, a path beside the workspace.
 * Each shape is a shell fragment run in the workspace root.
 */
const TWIN_SHAPES = {
  "through a link, then up": 'mkdir -p p/q p/sib/tools && ln -s ../.. p/q/up && ln -s p/q/up/../../sib/tools via',
  "through an absolute link, then up": 'mkdir -p p/q p/sib/tools && ln -s "$PWD" p/q/up && ln -s p/q/up/../sib/tools via',
  "three levels": 'mkdir -p p/q/r p/q/sib/tools p/sib/tools && ln -s ../../.. p/q/r/up && ln -s p/q/r/up/../../sib/tools via',
  "ending on the way up": 'mkdir -p p/q p/sib && ln -s ../.. p/q/up && ln -s p/q/up/../.. via',
  "with a dot after the link": 'mkdir -p p/q p/sib/tools && ln -s ../.. p/q/up && ln -s p/q/up/./../../sib/tools via',
  "with doubled separators": 'mkdir -p p/q p/sib/tools && ln -s ../.. p/q/up && ln -s p/q/up//..//..//sib/tools via',
  "to a file that is not there yet": 'mkdir -p p/q p/sib && ln -s ../.. p/q/up && ln -s p/q/up/../../sib/new-file via',
  "through two links": 'mkdir -p p/q p/sib/tools && ln -s .. p/q/one && ln -s q/one/.. p/two && ln -s p/two/../sib/tools via',
};
/** Links that stay in the working tree however they are read. */
const INSIDE_LINKS = 'mkdir -p in/deep && echo x > in/deep/f && ln -s in/deep plain && ln -s plain/f through && ln -s ../in/deep in/back && ln -s back/../deep/f in/twice';

/** Run every case, expecting a refusal before pnpm is reached. */
function expectRefused(t, cases) {
  const { outside, run } = harness(t);
  for (const [name, setup, message] of cases) {
    const r = run((dir) => setup(dir, outside));
    assert.notEqual(r.status, 0, `${name}: the install did not fail`);
    assert.match(r.err, message, name);
    assert.match(r.err, /^::error::install-deps: /m, name);
    assert.equal(r.installed, false, `${name}: pnpm install was reached`);
    assert.equal(existsSync(r.githubEnv), false, `${name}: the store was announced to later steps`);
  }
  // Nothing was written to the directory the links and paths pointed at.
  assert.deepEqual(readdirSync(outside), ["keep"]);
}

test("a tree the install cannot keep inside the workspace is refused before pnpm runs", (t) => {
  expectRefused(t, [
    [
      "a symlinked root node_modules",
      (dir, outside) => symlinkSync(outside, path.join(dir, "node_modules")),
      /node_modules is a symbolic link; the install refuses a symlinked node_modules/,
    ],
    [
      "a symlinked node_modules in a package, pointing inside",
      (dir) => symlinkSync(".", path.join(dir, "packages", "a", "node_modules")),
      /packages\/a\/node_modules is a symbolic link/,
    ],
    [
      "a node_modules the checkout brought with it",
      (dir) => mkdirSync(path.join(dir, "packages", "a", "node_modules")),
      /brings its own node_modules/,
    ],
    [
      "a package directory that is a link to outside",
      (dir, outside) => symlinkSync(outside, path.join(dir, "packages", "other")),
      /packages\/other is a symbolic link that resolves outside the workspace/,
    ],
    [
      "a lockfile that is a link, even to a regular file inside the workspace",
      (dir) => {
        cpSync(path.join(dir, "pnpm-lock.yaml"), path.join(dir, "real-lock.yaml"));
        rmSync(path.join(dir, "pnpm-lock.yaml"));
        symlinkSync("real-lock.yaml", path.join(dir, "pnpm-lock.yaml"));
      },
      /pnpm-lock\.yaml at the workspace root is not a regular file/,
    ],
    [
      "a root manifest that is a link",
      (dir) => {
        cpSync(path.join(dir, "package.json"), path.join(dir, "real.json"));
        rmSync(path.join(dir, "package.json"));
        symlinkSync("real.json", path.join(dir, "package.json"));
      },
      /package\.json at the workspace root is not a regular file/,
    ],
    [
      "a project manifest that is a directory",
      (dir) => {
        rmSync(path.join(dir, "packages", "b", "package.json"));
        mkdirSync(path.join(dir, "packages", "b", "package.json"));
      },
      /packages\/b\/package\.json is not a regular file/,
    ],
    [
      "a project manifest larger than the install reads",
      (dir) => writeFileSync(path.join(dir, "packages", "b", "package.json"), JSON.stringify({ ...MANIFESTS["packages/b"], description: "x".repeat(1024 * 1024) })),
      /packages\/b\/package\.json is larger than the install reads/,
    ],
    [
      "a workspace file that is a link",
      (dir) => {
        cpSync(path.join(dir, "pnpm-workspace.yaml"), path.join(dir, "ws.yaml"));
        rmSync(path.join(dir, "pnpm-workspace.yaml"));
        symlinkSync("ws.yaml", path.join(dir, "pnpm-workspace.yaml"));
      },
      /pnpm-workspace\.yaml at the workspace root is not a regular file/,
    ],
    ["a link that resolves nowhere", (dir) => symlinkSync("nowhere", path.join(dir, "dangling")), /does not resolve/],
    ["a link into .git", (dir) => symlinkSync(".git", path.join(dir, "meta")), /symbolic link into the repository's \.git/],
    // A link is judged by its text as well: where it resolves depends on who asks.
    ["a link to the asking process's directory", (dir) => symlinkSync("/proc/self/cwd", path.join(dir, "here")), /here is a symbolic link to a process or device path/],
    ["a link through the asking process's root", (dir) => symlinkSync(`/proc/self/root${dir}/packages`, path.join(dir, "packages", "y")), /packages\/y is a symbolic link to a process or device path/],
    ["a link to a device", (dir) => symlinkSync("/dev/fd/0", path.join(dir, "in")), /in is a symbolic link to a process or device path/],
    [
      "a link that leaves the workspace as written and comes back",
      (dir) => symlinkSync(`../${path.basename(dir)}/packages`, path.join(dir, "round")),
      /round is a symbolic link that resolves outside the workspace/,
    ],
    [
      "an absolute link elsewhere whose target resolves into the workspace",
      (dir) => {
        const back = path.join(dir, "..", "..", "back");
        symlinkSync(path.join(dir, "packages"), back);
        symlinkSync(path.resolve(back), path.join(dir, "via"));
      },
      /via is a symbolic link that resolves outside the workspace/,
    ],
    ["a link into .git as written, to something that is not there", (dir) => symlinkSync(".git/hooks/later", path.join(dir, "later")), /later is a symbolic link into the repository's \.git/],
    ...Object.entries(TWIN_SHAPES).map(([name, shape]) => [
      `a link that reads as inside and resolves beside the workspace: ${name}`,
      (dir) => assert.equal(spawnSync("sh", ["-c", shape], { cwd: dir }).status, 0, shape),
      /via is a symbolic link that resolves outside the workspace/,
    ]),
    ["a second .git", (dir) => mkdirSync(path.join(dir, "packages", "a", ".git")), /packages\/a\/\.git is a second \.git/],
    ["a directory that cannot be listed", (dir) => { mkdirSync(path.join(dir, "closed", "in"), { recursive: true }); chmodSync(path.join(dir, "closed"), 0o311); }, /closed cannot be listed \(EACCES\); the install does not skip what it cannot read/],
    ["no .git", (dir) => rmSync(path.join(dir, ".git"), { recursive: true }), /\.git is missing or is not a directory/],
    ["a .git that is a file", (dir) => { rmSync(path.join(dir, ".git"), { recursive: true }); writeFileSync(path.join(dir, ".git"), "gitdir: elsewhere\n"); }, /\.git is missing or is not a directory/],
    ["a .git that is a link", (dir) => { cpSync(path.join(dir, ".git"), path.join(dir, "realgit"), { recursive: true }); rmSync(path.join(dir, ".git"), { recursive: true }); symlinkSync("realgit", path.join(dir, ".git")); }, /\.git is missing or is not a directory/],
    [
      "a project directory that is a link, even to inside the workspace",
      (dir) => {
        rmSync(path.join(dir, "packages", "b"), { recursive: true });
        mkdirSync(path.join(dir, "elsewhere"));
        writeFileSync(path.join(dir, "elsewhere", "package.json"), JSON.stringify(MANIFESTS["packages/b"]));
        symlinkSync("../elsewhere", path.join(dir, "packages", "b"));
      },
      /names the project packages\/b, which is not a plain directory of this checkout/,
    ],
    [
      "a project the lockfile names that is not in the checkout",
      (dir) => rmSync(path.join(dir, "packages", "b"), { recursive: true }),
      /names the project packages\/b, which is not a plain directory/,
    ],
    [
      "a manifest in another format",
      (dir) => writeFileSync(path.join(dir, "packages", "a", "package.yaml"), "name: a\n"),
      /packages\/a\/package\.yaml is a package manifest in a format the install does not read/,
    ],
    [
      "a workspace file that names another project",
      (dir) => writeFileSync(path.join(dir, "pnpm-workspace.yaml"), `${TRUSTED_WORKSPACE}  - ../outside\n`),
      /pnpm-workspace\.yaml differs from main's/,
    ],
    [
      "a workspace file that carries a pnpm setting",
      (dir) => writeFileSync(path.join(dir, "pnpm-workspace.yaml"), `${TRUSTED_WORKSPACE}onlyBuiltDependencies:\n  - x\n`),
      /pnpm-workspace\.yaml differs from main's.*needs a person/,
    ],
    [
      "a workspace file that differs only in whitespace",
      (dir) => writeFileSync(path.join(dir, "pnpm-workspace.yaml"), `${TRUSTED_WORKSPACE}\n`),
      /pnpm-workspace\.yaml differs from main's/,
    ],
    ["no workspace file", (dir) => rmSync(path.join(dir, "pnpm-workspace.yaml")), /pnpm-workspace\.yaml at the workspace root is missing/],
    ["no lockfile", (dir) => rmSync(path.join(dir, "pnpm-lock.yaml")), /pnpm-lock\.yaml at the workspace root is missing/],
    [
      "a packageManager field naming another pnpm",
      (dir) => setManifest(dir, (m) => (m.packageManager = "pnpm@9.15.4")),
      /names packageManager "pnpm@9\.15\.4".*needs a person/,
    ],
    [
      "a packageManager field naming the pinned version with a suffix",
      (dir) => setManifest(dir, (m) => (m.packageManager = `pnpm@${PNPM_VERSION}+sha512.abc`)),
      /names packageManager/,
    ],
    ["no packageManager field", (dir) => setManifest(dir, (m) => delete m.packageManager), /names packageManager undefined/],
    ["a package.json that is not JSON", (dir) => writeFileSync(path.join(dir, "package.json"), "{"), /not valid JSON/],
    ...["onlyBuiltDependencies", "onlyBuiltDependenciesFile", "neverBuiltDependencies", "patchedDependencies", "configDependencies", "executionEnv", "packageExtensions"].map(
      (key) => [
        `package.json setting pnpm.${key}`,
        (dir) => setManifest(dir, (m) => (m.pnpm = { overrides: {}, [key]: {} })),
        new RegExp(`package\\.json sets pnpm\\.${key};.*needs a person`),
      ],
    ),
    [
      "a pnpm field that is not an object",
      (dir) => setManifest(dir, (m) => (m.pnpm = ["overrides"])),
      /"pnpm" field of package\.json is not an object/,
    ],
  ]);
});

test("a lockfile that names anything but registry packages and workspace projects is refused before pnpm runs", (t) => {
  const replaced = (from, to) => (dir) => setLockfile(dir, from, to);
  const resolution = (text) => replaced(RESOLUTION, `    resolution: ${text}\n`);
  const VERSION = "        specifier: ^1.0.0\n        version: 1.0.0\n";
  const NOT_INTEGRITY = /the resolution of dep@1\.0\.0 is not exactly \{integrity: sha512-…\}/;
  const NOT_PLAIN = /pnpm-lock\.yaml line \d+: /;
  expectRefused(t, [
    // How a package is fetched: by integrity from the registry, nothing else.
    ["a git resolution", resolution("{type: git, repo: https://example.invalid/x.git, commit: abc}"), NOT_PLAIN],
    ["a git resolution with word-only values", resolution("{type: git, repo: x, commit: abc}"), NOT_INTEGRITY],
    ["a git resolution behind a quoted key", resolution('{type: git, "repo":file://x/y, commit: abc}'), NOT_PLAIN],
    ["a directory resolution", resolution("{directory: ../outside, type: directory}"), NOT_PLAIN],
    ["a directory resolution with a word-only path", resolution("{directory: vendor, type: directory}"), NOT_INTEGRITY],
    ["a directory resolution behind a quoted key", resolution("{'directory': ../outside, type: directory}"), NOT_PLAIN],
    ["a tarball resolution", resolution("{tarball: file:vendor/dep-1.0.0.tgz}"), NOT_PLAIN],
    ["a tarball beside the integrity", resolution(`{integrity: ${INTEGRITY}, tarball: x.tgz}`), NOT_INTEGRITY],
    ["a resolution in block form", replaced(RESOLUTION, `    resolution:\n      integrity: ${INTEGRITY}\n      tarball: x.tgz\n`), NOT_INTEGRITY],
    ["an integrity that is not sha512", resolution("{integrity: sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA=}"), NOT_INTEGRITY],
    ["no resolution", replaced(RESOLUTION, ""), NOT_INTEGRITY],
    ["a package keyed by a local tarball", replaced("  dep@1.0.0:\n    res", "  dep@file:vendor/dep-1.0.0.tgz:\n    res"), NOT_PLAIN],
    ["a package keyed by a local tarball, quoted", replaced("  dep@1.0.0:\n    res", "  'dep@file:vendor/dep-1.0.0.tgz':\n    res"), /names a package that is not name@version from the registry/],
    ["a package keyed by a URL, quoted", replaced("  dep@1.0.0:\n    res", "  'dep@https://example.invalid/dep.tgz':\n    res"), /names a package that is not name@version from the registry/],
    ["a package keyed by a name with a path in it", replaced("  dep@1.0.0:\n    res", "  ../dep@1.0.0:\n    res"), /line \d+: a key is not in the plain form|not name@version/],
    ["a package entry that names itself", replaced(RESOLUTION, `${RESOLUTION}    name: other\n`), /the package dep@1\.0\.0 has the field "name"/],
    ["a package entry with a version of its own", replaced(RESOLUTION, `${RESOLUTION}    version: 2.0.0\n`), /has the field "version"/],
    ["a snapshot with a field the install does not know", replaced("  dep@1.0.0: {}", "  dep@1.0.0:\n    patched: true"), /the snapshot dep@1\.0\.0 has the field "patched"/],
    ["a snapshot with no package", replaced("  dep@1.0.0: {}", "  dep@1.0.0: {}\n\n  ghost@1.0.0: {}"), /the snapshot ghost@1\.0\.0 has no entry under packages/],
    ["a snapshot that depends on something undescribed", replaced("  dep@1.0.0: {}", "  dep@1.0.0:\n    dependencies:\n      ghost: 1.0.0"), /resolves ghost to "1\.0\.0", which is not a registry package this lockfile describes/],
    ["a snapshot that depends on a path", replaced("  dep@1.0.0: {}", "  dep@1.0.0:\n    dependencies:\n      b: link:../outside"), /resolves b to "link:\.\.\/outside"/],

    // What a project depends on: ranges and workspace ranges, resolved to
    // registry packages or to other projects.
    ["a project resolved to something undescribed", replaced(VERSION, "        specifier: ^1.0.0\n        version: 2.0.0\n"), /resolves dep to "2\.0\.0"/],
    ["a project resolved to a local tarball", replaced(VERSION, "        specifier: ^1.0.0\n        version: file:vendor/dep-1.0.0.tgz\n"), /resolves dep to "file:vendor\/dep-1\.0\.0\.tgz"/],
    ["a project resolved to a URL", replaced(VERSION, "        specifier: ^1.0.0\n        version: https://example.invalid/dep.tgz\n"), /resolves dep to "https:/],
    ...["github:x/y", "git+https://example.invalid/x.git", "https://example.invalid/dep.tgz", "file:../outside", "link:../outside", "npm:other@1.0.0", "x/y", "workspace:../outside"].map(
      (specifier) => [
        `the specifier ${specifier} in the lockfile`,
        replaced(VERSION, `        specifier: ${specifier}\n        version: 1.0.0\n`),
        /has the specifier .*; the install accepts a version range or a workspace: range only/,
      ],
    ),
    ["a link out of the workspace", replaced("version: link:../b", "version: link:../../../outside"), /links to link:\.\.\/\.\.\/\.\.\/outside, which is not another project of this workspace/],
    ["a link to a directory that is not a project", replaced("version: link:../b", "version: link:../../.git"), /which is not another project of this workspace/],
    ["a link in a flow mapping with quoted keys", replaced(`      dep:\n${VERSION}`, '      dep: {"specifier":link:../outside,"version":link:../outside}\n'), NOT_PLAIN],
    ["a dependency in a flow mapping", replaced(`      dep:\n${VERSION}`, "      dep: {specifier: link:../outside, version: link:../outside}\n"), NOT_PLAIN],
    ["a linked dependency under a name with a path in it", replaced("      a:\n        specifier: workspace:*", "      '@x/../../a':\n        specifier: workspace:*"), /depends on something that is not a package name: @x\/\.\.\/\.\.\/a/],
    ["a dependency with a third field", replaced(VERSION, `${VERSION}        resolution: x\n`), /is not exactly a specifier and a version/],
    ["a project with a field the install does not know", replaced("  packages/b: {}", "  packages/b:\n    publishDirectory: dist"), /the project packages\/b has the field "publishDirectory"/],
    ["a project that climbs out of the root", replaced("  packages/b: {}", "  ../outside: {}"), /line \d+: a key is not in the plain form|names a project that is not a plain path/],
    ["a project that climbs out from inside a path", replaced("  packages/b: {}", "  packages/../../outside: {}"), /names a project that is not a plain path under the workspace root/],
    ["an absolute project", (dir, outside) => setLockfile(dir, "  packages/b: {}", `  '${outside}': {}`), /names a project that is not a plain path/],
    ["an empty importers section", replaced(/importers:[^]*?\n\npackages:/.exec(LOCKFILE)[0], "importers: {}\n\npackages:"), /lists no importers/],
    ["no importers", (dir) => writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"), /lists no importers/],

    // What else a lockfile may carry: nothing.
    ["a section the install does not know", replaced("importers:", "patchedDependencies:\n  dep@1.0.0:\n    hash: abc\n    path: patches/dep.patch\n\nimporters:"), /the lockfile has the field "patchedDependencies"/],
    ["a pnpmfile checksum", replaced("importers:", "pnpmfileChecksum: abc\n\nimporters:"), /the lockfile has the field "pnpmfileChecksum"/],
    ["a setting the install does not know", replaced("  excludeLinksFromLockfile: false", "  excludeLinksFromLockfile: false\n  injectWorkspacePackages: true"), /settings has the field "injectWorkspacePackages"/],
    ["another lockfile version", replaced("lockfileVersion: '9.0'", "lockfileVersion: '6.0'"), /is not lockfileVersion '9\.0'/],
    ["an override that is not a version", replaced("importers:", "overrides:\n  dep: link:../outside\n\nimporters:"), /the override for dep is not a plain version or range/],
  ]);
});

test("a lockfile written any other way than pnpm writes it is refused before pnpm runs", (t) => {
  const replaced = (from, to) => (dir) => setLockfile(dir, from, to);
  const LINE = /^::error::install-deps: pnpm-lock\.yaml(?: line \d+)?: /m;
  expectRefused(t, [
    ["a double-quoted scalar", replaced("specifier: ^1.0.0", 'specifier: "^1.0.0"'), LINE],
    ["an escape", replaced("version: link:../b", "version: link:\\u002e\\u002e/b"), LINE],
    ["an anchor and an alias", replaced("version: link:../b", "version: &up link:../b\n      c:\n        version: *up"), LINE],
    ["a tag", replaced("version: 1.0.0", "version: !!str 1.0.0"), LINE],
    ["a merge key", replaced("  packages/b: {}", "  packages/b:\n    <<: {}"), LINE],
    ["a block scalar", replaced("version: 1.0.0", "version: |\n          1.0.0"), LINE],
    ["a scalar continued on the next line", replaced("version: 1.0.0", "version: 1.0.0\n          more"), LINE],
    ["a comment", replaced("importers:", "# note\nimporters:"), LINE],
    ["a trailing comment", replaced("version: 1.0.0", "version: 1.0.0 # note"), LINE],
    ["a tab", replaced("        version: 1.0.0", "\tversion: 1.0.0"), LINE],
    ["a carriage return", replaced("version: 1.0.0\n", "version: 1.0.0\r\n"), LINE],
    ["a non-breaking space as indentation", replaced("        version: 1.0.0", "      \u00a0 version: 1.0.0"), LINE],
    ["a line separator", replaced("version: 1.0.0", "version: 1.0.0\u2028"), LINE],
    ["trailing whitespace", replaced("version: 1.0.0\n", "version: 1.0.0 \n"), LINE],
    ["a duplicate key", replaced("        version: 1.0.0\n", "        version: 1.0.0\n        version: 2.0.0\n"), LINE],
    ["a duplicate key in a flow mapping", replaced(`{integrity: ${INTEGRITY}}`, `{integrity: ${INTEGRITY}, integrity: ${INTEGRITY}}`), LINE],
    ["an odd indentation", replaced("        version: 1.0.0", "         version: 1.0.0"), LINE],
    ["a key with no block under it", replaced("  packages/b: {}", "  packages/b:"), LINE],
    ["importers in flow style", (dir) => writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nimporters: {.: {}, ../outside: {}}\n"), LINE],
    ["a complex key", replaced("  packages/b: {}", "  ? packages/b\n  : {}"), LINE],
    ["a document marker", replaced("importers:", "---\nimporters:"), LINE],
    ["a second document", replaced("snapshots:", "...\nsnapshots:"), LINE],
    ["a number where a string is written", replaced("version: 1.0.0", "version: 1.0"), LINE],
    ["a null", replaced("version: 1.0.0", "version: ~"), LINE],
    ["a date", replaced("version: 1.0.0", "version: 2024-01-01"), LINE],
    ["a sequence under a mapping key at the same indent", replaced("  dep@1.0.0: {}", "  dep@1.0.0:\n    transitivePeerDependencies:\n    - x"), LINE],
    ["no final newline", (dir) => writeFileSync(path.join(dir, "pnpm-lock.yaml"), LOCKFILE.slice(0, -1)), /does not end with a newline/],
  ]);
});

test("a project manifest with a field the install does not know, or a name or path that is not plain, is refused before pnpm runs", (t) => {
  const SPECIFIER = /package\.json: \w+\.\w+ is .*; the install accepts a version range or a workspace: range only/;
  expectRefused(t, [
    ...["github:x/y", "git+ssh://git@example.invalid/x.git", "https://example.invalid/dep.tgz", "file:../outside", "link:../outside", "npm:other@1.0.0"].map((specifier) => [
      `the specifier ${specifier} in the root package.json`,
      (dir) => setManifest(dir, (m) => (m.devDependencies.dep = specifier)),
      SPECIFIER,
    ]),
    ["a URL specifier in a workspace package", (dir) => setManifest(dir, (m) => (m.optionalDependencies = { x: "github:x/y" }), "packages/a"), /packages\/a\/package\.json: optionalDependencies\.x is "github:x\/y"/],
    ["a path specifier among peer dependencies", (dir) => setManifest(dir, (m) => (m.peerDependencies = { x: "file:../x" }), "packages/b"), SPECIFIER],
    ["a specifier that is not a string", (dir) => setManifest(dir, (m) => (m.devDependencies.dep = { version: "1" })), SPECIFIER],
    ["a bin outside the project", (dir) => setManifest(dir, (m) => (m.bin = { tool: "../../../outside/tool" }), "packages/a"), /packages\/a\/package\.json: bin\.tool is not a plain path inside the package/],
    ["a bin given as an absolute path", (dir) => setManifest(dir, (m) => (m.bin = "/usr/bin/env"), "packages/a"), /bin\.a is not a plain path inside the package/],
    ["a bin that is neither a path nor an object", (dir) => setManifest(dir, (m) => (m.bin = ["x.js"]), "packages/a"), /bin is neither a path nor an object/],
    ["a bin directory", (dir) => setManifest(dir, (m) => (m.directories = { bin: "../../.." }), "packages/a"), /packages\/a\/package\.json has the field "directories"/],
    ["a man page list", (dir) => setManifest(dir, (m) => (m.man = ["../../x.1"]), "packages/a"), /has the field "man"/],
    ["a publish directory", (dir) => setManifest(dir, (m) => (m.publishConfig = { access: "public", directory: "../../../outside" }), "packages/b"), /publishConfig has directory; the install accepts only access, tag, provenance there/],
    ["dependenciesMeta", (dir) => setManifest(dir, (m) => (m.dependenciesMeta = { b: { injected: true } }), "packages/a"), /has the field "dependenciesMeta"/],
    ["resolutions", (dir) => setManifest(dir, (m) => (m.resolutions = { x: "1.0.0" })), /package\.json has the field "resolutions"/],
    ["bundled dependencies", (dir) => setManifest(dir, (m) => (m.bundledDependencies = ["b"]), "packages/a"), /has the field "bundledDependencies"/],
    ["a field nobody has heard of", (dir) => setManifest(dir, (m) => (m.somethingNew = true), "packages/b"), /packages\/b\/package\.json has the field "somethingNew"; the install accepts only the package\.json fields it knows/],
    // Strings an install turns into part of a path: a plain name each.
    ...["@x/../../../outside/tool", "../tool", "a/b", "@x/tool", "..", ".hidden", ""].map((name) => [
      `the bin name ${JSON.stringify(name)}`,
      (dir) => setManifest(dir, (m) => (m.bin = { [name]: "./x.js" }), "packages/a"),
      /packages\/a\/package\.json: bin has a name that is not a plain command name/,
    ]),
    ...["../x.js", "./a/../../x.js", "a//b.js", "a\\b.js", "", "./"].map((target) => [
      `the bin target ${JSON.stringify(target)}`,
      (dir) => setManifest(dir, (m) => (m.bin = { tool: target }), "packages/a"),
      /bin\.tool is not a plain path inside the package/,
    ]),
    ...["@x/../../../outside/pkg", "../pkg", "a/b", "@x/y/z", "", ".pkg"].map((name) => [
      `the package name ${JSON.stringify(name)}`,
      (dir) => setManifest(dir, (m) => ((m.name = name), (m.bin = "./x.js")), "packages/a"),
      /packages\/a\/package\.json: name is not a plain package name/,
    ]),
    ["no package name", (dir) => setManifest(dir, (m) => delete m.name, "packages/b"), /packages\/b\/package\.json: name is not a plain package name/],
    ["a version that is not one", (dir) => setManifest(dir, (m) => (m.version = "../1.0.0"), "packages/b"), /version is not a plain version/],
    ...["@x/../../y", "../y", "a/b/c"].map((name) => [
      `the dependency name ${JSON.stringify(name)}`,
      (dir) => setManifest(dir, (m) => (m.dependencies[name] = "^1.0.0"), "packages/a"),
      /dependencies names a dependency that is not a plain package name/,
    ]),
    ["engines that are not strings", (dir) => setManifest(dir, (m) => (m.engines = { node: { x: 1 } }), "packages/b"), /engines is not a map of strings/],
    ["a workspace package manifest that is not JSON", (dir) => writeFileSync(path.join(dir, "packages", "a", "package.json"), "{"), /packages\/a\/package\.json is not valid JSON/],
    ["a project without a manifest", (dir) => rmSync(path.join(dir, "packages", "b", "package.json")), /packages\/b\/package\.json is missing/],
  ]);
});

test("a lockfile the reader cannot get through at all is a refusal like any other", (t) => {
  const { run } = harness(t);
  const r = run((dir) => writeFileSync(path.join(dir, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\ndeprecated: ${"a ".repeat(30 * 1024 * 1024)}b\n`));
  assert.notEqual(r.status, 0);
  assert.match(r.err, /^::error::install-deps: pnpm-lock\.yaml/m);
  assert.doesNotMatch(r.err, /\n\s+at /, "the script died with a stack trace instead of refusing");
  assert.equal(r.installed, false);
});

test("the strict reader builds the tree a YAML parser would, for the forms it accepts", () => {
  const plain = (v) => (v instanceof Map ? Object.fromEntries([...v].map(([k, x]) => [k, plain(x)])) : v);
  assert.deepEqual(
    plain(
      parseStrictYaml(
        "a: '1.0'\nb:\n\n  'c@1.0.0(d@2.0.0)': {}\n  e f: {g: '>=1', h: ^1 || >=2}\n  i: [x64, 'arm64']\n  j:\n    - k\n    - '@l/m'\n" +
          "  deprecated: It's old - see https://example.invalid/#why\n  q: 'it''s'\no: true\n",
      ),
    ),
    {
      a: "1.0",
      b: {
        "c@1.0.0(d@2.0.0)": {},
        "e f": { g: ">=1", h: "^1 || >=2" },
        i: ["x64", "arm64"],
        j: ["k", "@l/m"],
        deprecated: "It's old - see https://example.invalid/#why",
        q: "it's",
      },
      o: true,
    },
  );
  assert.throws(() => parseStrictYaml("a: b"), Refusal);

  // One document per rule of the subset, each of which a YAML parser would
  // read as something other than what is written — or read at all.
  const outside = {
    "a double quote in free text": 'deprecated: say "x"\n',
    "a backslash in free text": "deprecated: a\\b\n",
    "a tab in free text": "deprecated: a\tb\n",
    "a duplicate key": "a: b\na: b\n",
    "a duplicate key in a flow mapping": "a: {b: c, b: c}\n",
    "a number": "a: 18\n",
    "a number in a flow mapping": "a: {b: 18}\n",
    "a float": "a: 1.5\n",
    "a null": "a: null\n",
    "a boolean in a flow mapping": "a: {b: yes}\n",
    "a number as a key": "1: b\n",
    "a quoted key in a flow mapping": "a: {'b': c}\n",
    "a colon-space inside a plain value": "a: b: c\n",
    "a value ending in a colon": "a: b:\n",
    "trailing whitespace": "a: {} \n",
    "text after a quoted scalar": "a: 'b' c\n",
    "a tag": "a: !!str b\n",
    "an anchor": "a: &x b\n",
    "an alias": "a: *x\n",
    "an anchor on a key": "&x a: b\n",
    "a complex key": "? a\n",
    "an unfinished flow sequence": "a: [b\n",
    "a block scalar in free text": "deprecated: |\n",
    "an anchor in free text": "deprecated: &x y\n",
    "a comment in free text": "deprecated: a #b\n",
    "an indentation of three": "a:\n   b: c\n",
    "a dedent to no open block": "a:\n    b: c\n  d: e\n",
    "a key with nothing under it": "a:\nb: c\n",
    "no final newline": "a: b",
  };
  for (const [what, text] of Object.entries(outside)) {
    assert.throws(() => parseStrictYaml(text), Refusal, `${what} was accepted: ${JSON.stringify(text)}`);
  }
  assert.deepEqual(checkLockfile(LOCKFILE), [".", "packages/a", "packages/b"]);
  assert.deepEqual(checkLockfile(WORKSPACE_LOCKFILE), [".", "packages/a", "packages/b"]);
  for (const ok of ["^1.0.0", "1.2.3", ">=1 <2", "*", "latest", "workspace:*", "workspace:^", "workspace:^1.0.0"]) {
    assert.equal(isAllowedSpecifier(ok), true, ok);
  }
  for (const no of ["", "workspace:", "workspace:../x", "npm:x@1", "catalog:", "a/b", "a:b", "https://x", undefined, 1]) {
    assert.equal(isAllowedSpecifier(no), false, String(no));
  }
});

test("the pnpm must be the pinned one, and without a container runtime there is no install", (t) => {
  const { run } = harness(t);
  const r = run(null, { pnpmVersion: "9.15.4" });
  assert.notEqual(r.status, 0);
  assert.match(r.err, new RegExp(`^::error::install-deps: the pnpm on PATH is 9\\.15\\.4; .*pnpm ${PNPM_VERSION.replaceAll(".", "\\.")}`, "m"));
  assert.equal(r.installed, false);

  // NO UNCONTAINED FALLBACK. With no runtime to run the container, the step
  // fails; the host does not run pnpm instead (the pnpm on PATH in these
  // tests throws if anything runs it).
  const none = run((dir) => writeFileSync(path.join(dir, ".npmrc"), "branch=1\n"), { docker: false });
  assert.notEqual(none.status, 0);
  assert.match(none.err, /^::error::install-deps: docker could not be run \(ENOENT\); the install runs only inside a container/m);
  assert.equal(existsSync(path.join(none.dir, "node_modules")), false);
  assert.equal(readFileSync(path.join(none.dir, ".npmrc"), "utf8"), "branch=1\n");
  assert.equal(existsSync(none.githubEnv), false);
});

test("without a runner temp directory outside the workspace there is no install", (t) => {
  const { run } = harness(t);
  const unset = run(null, { env: { RUNNER_TEMP: "" } });
  assert.notEqual(unset.status, 0);
  assert.match(unset.err, /^::error::install-deps: RUNNER_TEMP is not set to an existing directory/m);
  assert.equal(unset.installed, false);

  const inside = run((dir) => mkdirSync(path.join(dir, "tmp")), { env: { RUNNER_TEMP: "tmp" } });
  assert.notEqual(inside.status, 0);
  assert.match(inside.err, /RUNNER_TEMP is not set to an existing directory/);

  const { base } = harness(t);
  const dir = path.join(base, "ws");
  mkdirSync(path.join(dir, "rt"), { recursive: true });
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_WORKSPACE: dir, RUNNER_TEMP: path.join(dir, "rt") },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /^::error::install-deps: RUNNER_TEMP and the workspace contain one another/m);

  // The workspace itself is named plainly: no link, no `..`, not relative.
  const plain = run(null);
  assert.equal(plain.status, 0, plain.err);
  const alias = path.join(path.dirname(plain.dir), "alias");
  symlinkSync(plain.dir, alias);
  for (const [name, expected] of [
    [alias, /the workspace path is, or passes through, a symbolic link/],
    [`${plain.dir}/../ws`, /the workspace is not an existing absolute path without `\.\.`/],
    ["ws", /the workspace is not an existing absolute path/],
    [path.join(plain.dir, "nowhere"), /the workspace is not an existing absolute path/],
  ]) {
    const named = spawnSync(process.execPath, [SCRIPT], { cwd: plain.dir, encoding: "utf8", env: { PATH: process.env.PATH, GITHUB_WORKSPACE: name, RUNNER_TEMP: plain.rt } });
    assert.notEqual(named.status, 0, name);
    assert.match(named.stderr, expected, name);
  }
});

test("after the install, anything that left the workspace fails the step", (t) => {
  const { outside, run } = harness(t);
  const extra = (STUB_EXTRA, opts = {}) => run(null, { ...opts, stub: { STUB_EXTRA } });

  // Something appearing beside the workspace.
  const beside = extra("mkdir ../sibling");
  assert.equal(beside.installed, true);
  assert.notEqual(beside.status, 0);
  assert.match(beside.err, /^::error::install-deps: the install created or removed something beside the workspace/m);
  assert.equal(existsSync(beside.githubEnv), false);

  // Something appearing in the runner's temp directory, outside pnpm's own.
  const temp = extra('touch "$STUB_RT/dropped"');
  assert.notEqual(temp.status, 0);
  assert.match(temp.err, /created or removed something in the runner's temp directory/);
  // Inside pnpm's own directory is where the store goes.
  assert.equal(extra(`mkdir -p "$STUB_RT/${PNPM_DIR}/store/v10"`).status, 0);

  // The directory the script itself was staged in.
  const tools = extra('echo >> "$STUB_RT/agent-tools/install-deps-lockfile.mjs"', { staged: true });
  assert.notEqual(tools.status, 0);
  assert.match(tools.err, /the directory install-deps\.mjs runs from changed during the install/);
  const added = extra('touch "$STUB_RT/agent-tools/extra.mjs"', { staged: true });
  assert.match(added.err, /the directory install-deps\.mjs runs from changed during the install/);
  assert.equal(extra(":", { staged: true }).status, 0);
  // Also when pnpm itself failed.
  const failed = run(null, { staged: true, stub: { STUB_EXTRA: 'touch "$STUB_RT/agent-tools/extra.mjs"', STUB_EXIT: "3" } });
  assert.match(failed.err, /changed during the install/);
  assert.equal(failed.status, 1);

  // Git's hooks, configuration and info: what git acts on without being asked.
  for (const change of ["echo x > .git/hooks/pre-commit", "echo x >> .git/config", "echo x >> .git/info/exclude", "rm -rf .git/hooks"]) {
    const git = extra(change);
    assert.notEqual(git.status, 0, change);
    assert.match(git.err, /^::error::install-deps: the repository's git hooks, configuration or info changed during the install/m, change);
  }
  // The working tree itself: an install adds node_modules and nothing else.
  for (const change of ["echo x > PLANTED", "echo x >> package.json", "rm packages/b/package.json", "mkdir -p scripts && echo x > scripts/tool.mjs"]) {
    const tree = extra(change);
    assert.notEqual(tree.status, 0, change);
    assert.match(tree.err, /^::error::install-deps: the install changed the working tree outside node_modules/m, change);
  }
  assert.equal(extra("mkdir -p packages/a/node_modules/.bin && echo x > packages/a/node_modules/.bin/tool").status, 0);

  // A package manager's configuration in the runner's home.
  for (const change of ['echo x > "$STUB_HOME/.npmrc"', 'mkdir -p "$STUB_HOME/.config/pnpm" && echo x > "$STUB_HOME/.config/pnpm/rc"', 'echo x > "$STUB_HOME/.yarnrc.yml"']) {
    const home = extra(change);
    assert.notEqual(home.status, 0, change);
    assert.match(home.err, /^::error::install-deps: a package manager's configuration in the runner's home changed during the install/m, change);
  }
  // A link anywhere in the workspace that leaves its working tree, resolving or not — and a second `.git`.
  for (const change of [
    `ln -s ${outside} packages/b/elsewhere`,
    "mkdir -p node_modules/.pnpm/x && ln -s ../../../../.. node_modules/.pnpm/x/up",
    "ln -s .git/config later",
    "ln -s ../../../nowhere/at/all dangling",
    "mkdir -p node_modules/deep && ln -s ../../.git/hooks node_modules/deep/hooks",
  ]) {
    const link = extra(change);
    assert.notEqual(link.status, 0, change);
    assert.match(link.err, /^::error::install-deps: .* is a symbolic link out of the workspace's working tree after the install/m, change);
  }
  for (const change of ["mkdir -p sub/.git/hooks", "mkdir -p node_modules/pkg/.git"]) {
    const nested = extra(change);
    assert.notEqual(nested.status, 0, change);
    assert.match(nested.err, /\.git appeared during the install; a workspace has one \.git/, change);
  }

  // EVERY link is judged afterwards, not only the new ones — the check does
  // not lean on the one before the install — and by its text as well.
  for (const change of ["ln -s /proc/self/cwd node_modules/here", "mkdir -p node_modules/x && ln -s /dev/fd/0 node_modules/x/in", "ln -s ../../ws/packages node_modules/round"]) {
    const link = extra(change);
    assert.notEqual(link.status, 0, change);
    assert.match(link.err, /is a symbolic link out of the workspace's working tree after the install/, change);
  }
  // … and by following it the way a file is opened, also when the link it
  // goes through was made during the install.
  for (const [name, shape] of Object.entries(TWIN_SHAPES)) {
    const twin = extra(shape);
    assert.notEqual(twin.status, 0, name);
    assert.match(twin.err, /^::error::install-deps: via is a symbolic link out of the workspace's working tree after the install/m, name);
  }
  assert.equal(extra(`cd node_modules && ${INSIDE_LINKS}`).status, 0);
  // A path cannot be followed up out of a place that is not there: such a
  // link leads wherever that place later turns out to be.
  const odd = extra("ln -s nowhere/../packages node_modules/odd");
  assert.match(odd.err, /node_modules\/odd is a symbolic link out of the workspace's working tree after the install/);
  // Anything named node_modules that is not a project's own install directory
  // is part of the working tree like any other entry.
  for (const change of ["echo x > packages/node_modules", "mkdir -p src/node_modules/.bin && echo x > src/node_modules/.bin/tool", "echo x > packages/b/node_modules"]) {
    assert.match(extra(change).err, /^::error::install-deps: the install changed the working tree outside node_modules/m, change);
  }
  // Any mode bit of a tracked file or directory.
  for (const change of ["chmod 666 packages/a/package.json", "chmod 777 packages/b"]) {
    assert.match(extra(change).err, /the install changed the working tree outside node_modules/, change);
  }
  // A file git would ignore is still a change to the working tree.
  const ignored = run((dir) => writeFileSync(path.join(dir, ".gitignore"), "*.log\n"), { stub: { STUB_EXTRA: "echo x > packages/a/build.log" } });
  assert.match(ignored.err, /^::error::install-deps: the install changed the working tree outside node_modules/m);
  // So is a file made executable.
  assert.match(extra("chmod +x packages/a/package.json").err, /the install changed the working tree outside node_modules/);
  // WHAT CANNOT BE LISTED IS A REFUSAL, NOT A SKIP: a closed directory — in
  // node_modules, in the tree, or the root itself — hides nothing.
  for (const change of ["mkdir -p node_modules/c/in && chmod 311 node_modules/c", "mkdir -p packages/a/node_modules/c && chmod 311 packages/a/node_modules/c", "chmod 311 packages/b", "chmod 311 ."]) {
    const closed = extra(change);
    assert.notEqual(closed.status, 0, change);
    assert.match(closed.err, /^::error::install-deps: .* cannot be (listed|read) \(EACCES\); the install does not skip what it cannot read/m, change);
    assert.equal(existsSync(closed.githubEnv), false, change);
  }

  // THE RUNNER WRITES NOTHING UNDER THE WORKSPACE AFTER THE CONTAINER RAN. A
  // directory that held a `.npmrc` is, afterwards, a link out of the
  // workspace: nothing is put back through it.
  const swapped = run(
    (dir) => {
      mkdirSync(path.join(dir, "d"));
      writeFileSync(path.join(dir, "d", ".npmrc"), "branch=1\n");
    },
    { stub: { STUB_EXTRA: `rm -rf d && ln -s ${outside} d` } },
  );
  assert.notEqual(swapped.status, 0);
  assert.deepEqual(readdirSync(outside), ["keep"], "the runner wrote through a link the install left behind");
  assert.deepEqual(readdirSync(swapped.home), [], "the runner's home was written to");

  // A project's node_modules that became a link.
  const linked = extra(`ln -s ${outside} packages/a/node_modules`);
  assert.notEqual(linked.status, 0);
  assert.match(linked.err, /packages\/a\/node_modules is a symbolic link out of the workspace's working tree after the install/);
  // … even to somewhere inside the workspace.
  const inward = extra("ln -s ../b packages/a/node_modules");
  assert.notEqual(inward.status, 0);
  assert.match(inward.err, /the install changed the working tree outside node_modules|packages\/a\/node_modules is a symbolic link after the install/);

  // An installed entry, scoped or not, that resolves outside.
  for (const entry of ["dep", "@scope/dep"]) {
    const escaped = extra(`mkdir -p node_modules/@scope && ln -s ${outside} node_modules/${entry}`);
    assert.notEqual(escaped.status, 0, entry);
    assert.match(escaped.err, /is a symbolic link out of the workspace's working tree after the install/, entry);
  }
});

test("hashTree cannot be made to read two different trees as one", (t) => {
  // A file whose bytes spell out "…then a directory, then a file in it" is
  // not the same tree as that directory and that file.
  const base = mkdtempSync(path.join(TMP, "install-deps-inject-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const one = path.join(base, "one");
  const two = path.join(base, "two");
  mkdirSync(one);
  mkdirSync(path.join(two, "b"), { recursive: true });
  writeFileSync(path.join(two, "a"), "A");
  writeFileSync(path.join(two, "b", "c"), "C");
  const mode = (f) => String(lstatSync(f).mode & 0o7777);
  const m = mode(path.join(two, "a"));
  const dm = mode(path.join(two, "b"));
  // The body a file would need under a separator-only encoding, and under this one.
  for (const body of [`A\0d\0b\0f\0b/c\0-\0C`, `A\0dir\0b\0${dm}\0file\0b/c\0${m}\0C`, `A3:dir1:b${dm.length}:${dm}4:file3:b/c${m.length}:${m}1:C`]) {
    writeFileSync(path.join(one, "a"), body);
    assert.notEqual(hashTree(one), hashTree(two), JSON.stringify(body));
  }
});

test("hashTree changes with any file, name or link in the directory", (t) => {
  const dir = mkdtempSync(path.join(TMP, "install-deps-hash-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "sub"));
  writeFileSync(path.join(dir, "a"), "1");
  writeFileSync(path.join(dir, "sub", "b"), "2");
  const seen = new Set([hashTree(dir)]);
  const changed = (what) => {
    const h = hashTree(dir);
    assert.equal(seen.has(h), false, `${what} did not change the digest`);
    seen.add(h);
  };
  assert.equal(seen.has(hashTree(dir)), true);
  writeFileSync(path.join(dir, "a"), "2");
  changed("a file's content");
  writeFileSync(path.join(dir, "sub", "c"), "");
  changed("a new file");
  mkdirSync(path.join(dir, "empty"));
  changed("a new directory");
  symlinkSync("a", path.join(dir, "link"));
  changed("a new link");
  rmSync(path.join(dir, "link"));
  symlinkSync("sub", path.join(dir, "link"));
  changed("a link's target");
});

test("a failing pnpm fails the step and the branch's .npmrc still comes back", (t) => {
  const { run } = harness(t);
  const r = run((dir) => writeFileSync(path.join(dir, ".npmrc"), "branch=1\n"), { stub: { STUB_EXIT: "7" } });
  assert.equal(r.status, 7);
  assert.equal(readFileSync(path.join(r.dir, ".npmrc"), "utf8"), "branch=1\n");
  assert.equal(existsSync(r.githubEnv), false);
});

test("the container half sets every .npmrc aside for pnpm and puts it back, whatever pnpm did", (t) => {
  // Run here as a plain script, with a stand-in for pnpm: what it does is
  // file work in its working directory, the same in or out of a container.
  const base = mkdtempSync(path.join(TMP, "install-deps-entry-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const pnpm = path.join(base, "pnpm.cjs");
  writeFileSync(
    pnpm,
    "const fs = require('fs');\n" +
      "const seen = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.npmrc') seen.push(d + '/' + e.name); else if (e.isDirectory() && e.name !== '.git') walk(d + '/' + e.name); } }; walk('.');\n" +
      "fs.writeFileSync(process.env.SEEN, JSON.stringify({ args: process.argv.slice(2), seen, root: fs.existsSync('.npmrc') ? fs.readFileSync('.npmrc', 'utf8') : null }));\n" +
      "if (process.env.DO) eval(process.env.DO);\n" +
      "process.exit(Number(process.env.EXIT ?? 0));\n",
  );
  let n = 0;
  const run = (env = {}) => {
    const dir = path.join(base, `ws${++n}`);
    mkdirSync(path.join(dir, "packages", "a", ".npmrc", "deep"), { recursive: true });
    mkdirSync(path.join(dir, "packages", "b"), { recursive: true });
    mkdirSync(path.join(dir, ".git"));
    writeFileSync(path.join(dir, ".npmrc"), "root=1\n");
    writeFileSync(path.join(dir, ".git", ".npmrc"), "git=1\n");
    writeFileSync(path.join(dir, "packages", "a", ".npmrc", "deep", "f"), "dir\n");
    writeFileSync(path.join(dir, "packages", "b", ".npmrc"), "nested=1\n");
    symlinkSync("packages/b/.npmrc", path.join(dir, "packages", ".npmrc"));
    const seen = path.join(base, `seen${n}`);
    const r = spawnSync(process.execPath, [ENTRY, pnpm, "install", "--flag"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: base, SEEN: seen, ...env } });
    return { dir, status: r.status, err: r.stderr, seen: existsSync(seen) ? JSON.parse(readFileSync(seen, "utf8")) : null };
  };
  const intact = (dir) => {
    assert.equal(readFileSync(path.join(dir, ".npmrc"), "utf8"), "root=1\n");
    assert.equal(readFileSync(path.join(dir, "packages", "a", ".npmrc", "deep", "f"), "utf8"), "dir\n");
    assert.equal(readFileSync(path.join(dir, "packages", "b", ".npmrc"), "utf8"), "nested=1\n");
    assert.equal(spawnSync("readlink", [path.join(dir, "packages", ".npmrc")], { encoding: "utf8" }).stdout.trim(), "packages/b/.npmrc");
  };

  // pnpm runs with its arguments and sees no `.npmrc` anywhere in the tree.
  const ok = run();
  assert.equal(ok.status, 0, ok.err);
  assert.deepEqual(ok.seen, { args: ["install", "--flag"], seen: [], root: null });
  intact(ok.dir);
  assert.deepEqual(readdirSync(base).filter((f) => f.startsWith("npmrc-")), [], "the stash was left behind");

  // Main's own `.npmrc`, when given, is the root one for the install and gone afterwards.
  const trusted = path.join(base, "trusted-npmrc");
  writeFileSync(trusted, "main=1\n");
  const withMain = run({ INSTALL_DEPS_NPMRC: trusted });
  assert.deepEqual(withMain.seen.seen, ["./.npmrc"]);
  assert.equal(withMain.seen.root, "main=1\n");
  intact(withMain.dir);
  // … also when the branch had no root `.npmrc` of its own to come back.
  const onlyMain = path.join(base, "only-main");
  mkdirSync(path.join(onlyMain, ".git"), { recursive: true });
  const lone = spawnSync(process.execPath, [ENTRY, pnpm, "install"], { cwd: onlyMain, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: base, SEEN: path.join(base, "seen-lone"), INSTALL_DEPS_NPMRC: trusted } });
  assert.equal(lone.status, 0, lone.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(base, "seen-lone"), "utf8")).root, "main=1\n");
  assert.deepEqual(readdirSync(onlyMain), [".git"], "main's .npmrc was left in the workspace");

  // pnpm's exit status is the script's, and the files come back all the same —
  // also when pnpm left a `.npmrc` of its own where one was set aside.
  const failed = run({ EXIT: "7", DO: "fs.writeFileSync('.npmrc', 'left=1\\n'); fs.mkdirSync('packages/b/.npmrc');" });
  assert.equal(failed.status, 7);
  intact(failed.dir);

  // A place that is gone cannot be restored into; the script says so and fails.
  const gone = run({ DO: "fs.rmSync('packages/b', { recursive: true }); fs.writeFileSync('packages/b', 'now a file');" });
  assert.notEqual(gone.status, 0);
  assert.match(gone.err, /could not put packages\/b\/\.npmrc back/);
});

test("a name that is not UTF-8 is refused, before the install and after it", (t) => {
  // Read leniently, such a name comes back with a replacement character in
  // it, and that string names a DIFFERENT file — one shipped beside it, so
  // that every check is made on the decoy instead. Names are read as bytes.
  if (!NON_UTF8_NAMES) {
    t.skip(NEEDS_NON_UTF8);
    return;
  }
  const { outside, run } = harness(t);
  const NOT_UTF8 = /^::error::install-deps: .*\\xff has a name that is not valid UTF-8; the install reads only names it can name exactly/m;
  const sub = (dir, name, rest) => Buffer.concat([rawPath(dir, name), Buffer.from(rest)]);
  const before = {
    "a link out, with a decoy that stays in": (dir) => {
      symlinkSync(outside, rawPath(dir, "x"));
      symlinkSync("pnpm-lock.yaml", path.join(dir, `x${REPLACEMENT}`));
    },
    "a link into .git, with a decoy": (dir) => {
      symlinkSync(".git/hooks", rawPath(dir, "x"));
      symlinkSync("pnpm-lock.yaml", path.join(dir, `x${REPLACEMENT}`));
    },
    "a whole directory, with an empty decoy": (dir) => {
      mkdirSync(rawPath(dir, "d"));
      mkdirSync(sub(dir, "d", "/node_modules"));
      symlinkSync(outside, sub(dir, "d", "/out"));
      writeFileSync(sub(dir, "d", "/package.yaml"), "name: x\n");
      mkdirSync(path.join(dir, `d${REPLACEMENT}`));
    },
    "a file with no decoy": (dir) => writeFileSync(rawPath(dir, "f"), "data"),
    "a name deep in a project": (dir) => writeFileSync(rawPath(path.join(dir, "packages", "a"), "g"), "data"),
  };
  for (const [name, setup] of Object.entries(before)) {
    const r = run(setup);
    assert.notEqual(r.status, 0, name);
    assert.match(r.err, NOT_UTF8, name);
    assert.equal(r.installed, false, `${name}: pnpm install was reached`);
  }
  // A link whose TEXT is not UTF-8, beside a decoy name that is.
  const text = run((dir) => {
    writeFileSync(path.join(dir, `x${REPLACEMENT}`), "decoy");
    symlinkSync(Buffer.from([0x78, 0xff]), path.join(dir, "via"));
  });
  assert.notEqual(text.status, 0);
  assert.match(text.err, /via is a symbolic link that resolves outside the workspace/);
  assert.equal(text.installed, false);
  // Made by the install: in node_modules beside a decoy, and at the root.
  for (const change of [
    // (Double quotes only: the stub's configuration holds this in single quotes.)
    `ln -s "$STUB_RT" "node_modules/x$(printf "\\377")" && ln -s . "node_modules/x$(printf "\\357\\277\\275")"`,
    `echo x > "f$(printf "\\377")"`,
  ]) {
    const r = run(null, { stub: { STUB_EXTRA: change } });
    assert.notEqual(r.status, 0, change);
    assert.match(r.err, NOT_UTF8, change);
    assert.equal(existsSync(r.githubEnv), false, change);
  }
  // Beside the workspace and in the runner's temp directory, a name swapped
  // for another that reads the same when decoded leniently is a change.
  const swapped = run((dir) => writeFileSync(rawPath(path.join(dir, "..", "..", "rt"), "a"), ""), {
    stub: { STUB_EXTRA: `mv "$STUB_RT/a$(printf "\\377")" "$STUB_RT/a$(printf "\\376")"` },
  });
  assert.notEqual(swapped.status, 0);
  assert.match(swapped.err, /created or removed something in the runner's temp directory/);
  assert.deepEqual(readdirSync(outside), ["keep"]);
});

test("a name that is UTF-8 is accepted, a replacement character included", (t) => {
  // The control: the character a lenient decoding produces is itself valid
  // UTF-8, and a name that really contains it is an ordinary name.
  const { run } = harness(t);
  const ok = run((dir) => {
    writeFileSync(path.join(dir, `x${REPLACEMENT}`), "a file");
    symlinkSync(`x${REPLACEMENT}`, path.join(dir, `y${REPLACEMENT}`));
    mkdirSync(path.join(dir, "ünïcödé"));
    writeFileSync(path.join(dir, "ünïcödé", "f"), "x");
  });
  assert.equal(ok.status, 0, ok.err);
  assert.equal(ok.installed, true);
});

test("the container half refuses a name that is not UTF-8 before it moves or runs anything", (t) => {
  if (!NON_UTF8_NAMES) {
    t.skip(NEEDS_NON_UTF8);
    return;
  }
  const base = mkdtempSync(path.join(TMP, "install-deps-entry-names-"));
  t.after(() => removeTree(base));
  const dir = path.join(base, "ws");
  mkdirSync(path.join(dir, ".git"), { recursive: true });
  writeFileSync(path.join(dir, ".npmrc"), "root=1\n");
  mkdirSync(rawPath(dir, "d"));
  writeFileSync(Buffer.concat([rawPath(dir, "d"), Buffer.from("/.npmrc")]), "nested=1\n");
  const ran = path.join(base, "ran");
  const pnpm = path.join(base, "pnpm.cjs");
  writeFileSync(pnpm, `require("fs").writeFileSync(${JSON.stringify(ran)}, "")\n`);
  const r = spawnSync(process.execPath, [ENTRY, pnpm, "install"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: base } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /install-deps: a name in the workspace is not valid UTF-8; the install does not run/);
  assert.equal(existsSync(ran), false, "pnpm ran");
  assert.equal(readFileSync(path.join(dir, ".npmrc"), "utf8"), "root=1\n", "a .npmrc was moved");
});

test("with the real runtime and the real pnpm: nothing the branch wrote runs, and the install stays inside", (t) => {
  // THE STUB CANNOT SHOW THIS. It records the command line; only a real
  // container and pnpm itself show that under it a lifecycle script, a
  // pnpmfile and a `.npmrc` that moves the modules directory all come to
  // nothing, that `.git` cannot be written, and that what is installed is
  // usable from outside the container. Needs docker and the pinned pnpm on
  // PATH — CI's `verify-self` job has both — and the network once, to pull
  // the image; the tree itself depends only on its own workspace packages.
  const pnpmBin = spawnSync("sh", ["-c", "command -v pnpm"], { encoding: "utf8" }).stdout.trim();
  let pnpmDir = pnpmBin && path.dirname(realpathSync(pnpmBin));
  while (pnpmDir && !existsSync(path.join(pnpmDir, "package.json")) && path.dirname(pnpmDir) !== pnpmDir) pnpmDir = path.dirname(pnpmDir);
  // … or a launcher in a `.bin` beside the package, as the setup action installs it.
  const beside = pnpmBin && path.join(path.dirname(realpathSync(pnpmBin)), "..", "pnpm", "package.json");
  const manifestFile = beside && path.basename(path.dirname(realpathSync(pnpmBin))) === ".bin" && existsSync(beside) ? beside : pnpmDir && path.join(pnpmDir, "package.json");
  const found = manifestFile && existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : {};
  if (found.name !== "pnpm" || found.version !== PNPM_VERSION) {
    t.skip(`needs the pnpm ${PNPM_VERSION} package on PATH (found ${found.version ?? "none"})`);
    return;
  }
  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    t.skip("needs a running docker");
    return;
  }
  const base = mkdtempSync(path.join(TMP, "install-deps-real-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = path.join(base, "area", "ws");
  const marks = path.join(dir, ".marks");
  const rt = path.join(base, "rt");
  mkdirSync(rt);
  // Marks are left INSIDE the workspace: it is the one place a script run in
  // the container could leave one that this test can see.
  const mark = (name) => `node -e "require('fs').writeFileSync('${marks}/${name}', '')"`;
  mkdirSync(path.join(dir, "packages", "a"), { recursive: true });
  mkdirSync(path.join(dir, "packages", "b"), { recursive: true });
  mkdirSync(marks);
  spawnSync(GIT, ["init", "-q", dir]);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      packageManager: `pnpm@${PNPM_VERSION}`,
      devDependencies: { a: "workspace:*" },
      scripts: { preinstall: mark("root-preinstall"), postinstall: mark("root-postinstall"), prepare: mark("root-prepare") },
    }),
  );
  writeFileSync(
    path.join(dir, "packages", "a", "package.json"),
    JSON.stringify({ name: "a", version: "1.0.0", bin: { tool: "./tool.js" }, dependencies: { b: "workspace:*" }, scripts: { postinstall: mark("a-postinstall") } }),
  );
  writeFileSync(path.join(dir, "packages", "a", "tool.js"), "#!/usr/bin/env node\nconsole.log('tool ran');\n", { mode: 0o755 });
  writeFileSync(path.join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "b", version: "1.0.0" }));
  writeFileSync(path.join(dir, "pnpm-workspace.yaml"), TRUSTED_WORKSPACE);
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), WORKSPACE_LOCKFILE);
  writeFileSync(path.join(dir, ".npmrc"), "modules-dir=../moved\nvirtual-store-dir=../moved-store\nstore-dir=../moved-pnpm-store\n");
  writeFileSync(path.join(dir, ".pnpmfile.cjs"), `require('fs').writeFileSync('${marks}/pnpmfile', ''); module.exports = { hooks: {} };\n`);

  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      GITHUB_WORKSPACE: dir,
      RUNNER_TEMP: rt,
      // Settings in the job's environment are not pnpm's to read either.
      npm_config_ignore_scripts: "false",
      npm_config_modules_dir: "../moved-by-env",
      npm_config_store_dir: path.join(base, "area", "store-by-env"),
    },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(marks), [], "something the branch wrote was executed");
  assert.ok(existsSync(path.join(dir, "node_modules", "a")), "the root project was not installed");
  assert.ok(existsSync(path.join(dir, "packages", "a", "node_modules", "b")), "a workspace project was not installed");
  assert.deepEqual(readdirSync(path.join(base, "area")), ["ws"], "the install wrote beside the workspace");
  assert.deepEqual(readdirSync(rt), [PNPM_DIR], "the install wrote in the runner's temp directory outside its own");
  assert.match(readFileSync(path.join(dir, "node_modules", ".modules.yaml"), "utf8"), new RegExp(`storeDir: ${path.join(rt, PNPM_DIR, "store")}`));
  assert.match(readFileSync(path.join(dir, ".npmrc"), "utf8"), /^modules-dir=\.\.\/moved\n/);
  // What the container installed is usable from outside it: the linked
  // executable resolves and runs on the host.
  const tool = spawnSync(path.join(dir, "node_modules", ".bin", "tool"), [], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(tool.stdout.trim(), "tool ran", tool.stderr);
});

test("the copies beside the script are main's own files, and the pins are this repository's", () => {
  // RUNS ON EVERY PULL REQUEST that touches either side: `scripts/agent/**`
  // selects this lane, and a root `package.json`, `pnpm-workspace.yaml`,
  // `pnpm-lock.yaml` or `.npmrc` is unclassified in `harness.config.json`,
  // which forces every lane.
  const manifest = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));

  // The pnpm the install was audited against is the one the repository uses.
  // Moving `packageManager` means re-running the audit and moving the pin.
  assert.equal(
    manifest.packageManager,
    `pnpm@${PNPM_VERSION}`,
    "package.json's packageManager and install-deps.mjs's PNPM_VERSION differ — re-run the install audit " +
      "(docs/design/agent-pipeline/agent-install.md) for the new pnpm, then move PNPM_VERSION",
  );

  // Main's own `pnpm` settings are all on the allow-list, so the agent jobs can
  // install main. A new key is a decision: check what it does under the
  // hardened flags before allowing it.
  const extra = Object.keys(manifest.pnpm ?? {}).filter((key) => !ALLOWED_PNPM_KEYS.includes(key));
  assert.deepEqual(extra, [], `package.json sets pnpm.${extra.join(", pnpm.")}, which install-deps.mjs refuses`);

  assert.equal(
    TRUSTED_WORKSPACE,
    readFileSync(path.join(REPO, "pnpm-workspace.yaml"), "utf8"),
    "scripts/agent/install-deps.workspace.yaml is not the root pnpm-workspace.yaml — copy it over",
  );

  const rootNpmrc = path.join(REPO, ".npmrc");
  const copy = path.join(HERE, "install-deps.npmrc");
  assert.equal(
    existsSync(copy),
    existsSync(rootNpmrc),
    "the root .npmrc and scripts/agent/install-deps.npmrc must both exist or both be absent",
  );
  if (existsSync(copy)) {
    assert.equal(readFileSync(copy, "utf8"), readFileSync(rootNpmrc, "utf8"), "scripts/agent/install-deps.npmrc is not the root .npmrc — copy it over");
  }
});

test("the symbolic links this repository tracks are the ones known here", () => {
  // The install judges every link in a checkout. This pins which ones main
  // has, so a new one arrives as a change to this list, seen in review.
  const r = spawnSync(GIT, ["ls-files", "-s"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  const links = r.stdout.split("\n").filter((l) => l.startsWith("120000 ")).map((l) => l.slice(l.indexOf("\t") + 1));
  assert.deepEqual(links, ["AGENTS.md"]);
  assert.equal(spawnSync("readlink", [path.join(REPO, "AGENTS.md")], { encoding: "utf8" }).stdout.trim(), "CLAUDE.md");
});

test("this repository's own lockfile and manifests are ones the agent jobs install", async () => {
  // THE ALLOW-LIST IS MAIN'S SHAPE, so main must fit it. A pull request that
  // adds a dependency from outside the registry, or whose lockfile pnpm wrote
  // in a form the strict reader does not take, fails here — on the pull
  // request — rather than in the first agent round after it merges. Either
  // the dependency changes, or the allow-list does, deliberately.
  let importers;
  try {
    importers = checkLockfile(readFileSync(path.join(REPO, "pnpm-lock.yaml"), "utf8"));
  } catch (error) {
    assert.fail(`the root pnpm-lock.yaml is refused by install-deps-lockfile.mjs: ${error.message}`);
  }
  assert.ok(importers.includes(".") && importers.length > 1, "the root lockfile lists no workspace projects");
  assert.ok(MANIFEST_KEYS.includes("bin") && !MANIFEST_KEYS.includes("directories") && !MANIFEST_KEYS.includes("man"));
  const { checkProjects } = await import("./install-deps-lockfile.mjs");
  try {
    checkProjects(REPO, importers);
  } catch (error) {
    assert.fail(`a project manifest is refused by install-deps-lockfile.mjs: ${error.message}`);
  }
});
