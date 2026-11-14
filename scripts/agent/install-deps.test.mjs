// `install-deps.mjs` is the dependency install of the agent jobs that hold a
// token while a pull request's branch is in the workspace. These tests RUN it —
// against small trees under the OS temp directory — rather than read it: with
// `pnpm` replaced by a stub that records whether it was reached, for every
// refusal; and with the real pnpm, for one install that proves the flags do
// what the stub can only record.
//
// The pins at the bottom compare the copies shipped beside the script with the
// repository's own files, so a pull request that changes one without the other
// fails here.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_PNPM_KEYS, INSTALL_ARGS, PNPM_VERSION } from "./install-deps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SCRIPT = path.join(HERE, "install-deps.mjs");
const TRUSTED_WORKSPACE = readFileSync(path.join(HERE, "install-deps.workspace.yaml"), "utf8");

const MANIFEST = { name: "root", private: true, packageManager: `pnpm@${PNPM_VERSION}` };
const LOCKFILE =
  "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\n" +
  "importers:\n\n  .:\n    devDependencies:\n      a:\n        specifier: workspace:*\n        version: link:packages/a\n\n" +
  "  packages/a:\n    dependencies:\n      b:\n        specifier: workspace:*\n        version: link:../b\n\n" +
  "  packages/b: {}\n";

/** A temp area holding a stub `pnpm` and one workspace per case. */
function harness(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), "install-deps-test-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = path.join(base, "bin");
  mkdirSync(bin);
  mkdirSync(path.join(base, "ran"));
  // The stub answers `--version`, and for anything else says it ran, records
  // the `.npmrc` it ran under, makes the directory an install makes, and does
  // whatever extra the case asks of it.
  writeFileSync(
    path.join(bin, "pnpm"),
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "${STUB_VERSION:-' + PNPM_VERSION + '}"; exit 0; fi',
      'echo "$*" > "$STUB_RAN"',
      'if [ -e .npmrc ]; then cat .npmrc > "$STUB_RAN.npmrc"; fi',
      "mkdir -p node_modules",
      'if [ -n "$STUB_EXTRA" ]; then eval "$STUB_EXTRA"; fi',
      'exit "${STUB_EXIT:-0}"',
      "",
    ].join("\n"),
  );
  chmodSync(path.join(bin, "pnpm"), 0o755);
  const outside = path.join(base, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "keep"), "keep");

  let n = 0;
  /** Run the script on a fresh tree; `setup` shapes it first. */
  const run = (setup, env = {}) => {
    const dir = path.join(base, `case${++n}`, "ws");
    for (const pkg of ["a", "b"]) {
      mkdirSync(path.join(dir, "packages", pkg), { recursive: true });
      writeFileSync(path.join(dir, "packages", pkg, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0" }));
    }
    mkdirSync(path.join(dir, ".git"));
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(MANIFEST));
    writeFileSync(path.join(dir, "pnpm-workspace.yaml"), TRUSTED_WORKSPACE);
    writeFileSync(path.join(dir, "pnpm-lock.yaml"), LOCKFILE);
    setup?.(dir);
    const ran = path.join(base, "ran", String(n));
    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        GITHUB_WORKSPACE: dir,
        STUB_RAN: ran,
        STUB_EXTRA: "",
        ...env,
      },
    });
    return { dir, status: r.status, out: r.stdout, err: r.stderr, installed: existsSync(ran), ran };
  };
  return { base, outside, run };
}

const setManifest = (dir, change) => {
  const manifest = structuredClone(MANIFEST);
  change(manifest);
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
};
const setLockfile = (dir, from, to) => {
  assert.ok(LOCKFILE.includes(from), `the fixture lockfile has no ${JSON.stringify(from)}`);
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), LOCKFILE.replace(from, to));
};

test("an ordinary tree installs: pinned flags, the branch's .npmrc set aside and put back", (t) => {
  const { run } = harness(t);
  const ok = run((dir) => {
    writeFileSync(path.join(dir, ".npmrc"), "branch=1\n");
    writeFileSync(path.join(dir, "packages", "a", ".npmrc"), "nested=1\n");
    // A directory of that name is set aside and put back as well.
    mkdirSync(path.join(dir, "packages", "b", ".npmrc"));
    writeFileSync(path.join(dir, "packages", "b", ".npmrc", "inner"), "x");
    // A link that stays inside the workspace is not refused.
    symlinkSync("packages", path.join(dir, "alias"));
    // `overrides` is the one pnpm setting main carries.
    setManifest(dir, (m) => {
      m.pnpm = { overrides: { "x@<1": "1.0.0" } };
    });
  });
  assert.equal(ok.status, 0, ok.err);
  assert.equal(ok.installed, true);
  assert.equal(readFileSync(ok.ran, "utf8").trim(), INSTALL_ARGS.join(" "));
  // Main carries no `.npmrc`, so the install ran with none in the tree at all.
  assert.equal(existsSync(`${ok.ran}.npmrc`), existsSync(path.join(HERE, "install-deps.npmrc")));
  assert.equal(readFileSync(path.join(ok.dir, ".npmrc"), "utf8"), "branch=1\n");
  assert.equal(readFileSync(path.join(ok.dir, "packages", "a", ".npmrc"), "utf8"), "nested=1\n");
  assert.equal(readFileSync(path.join(ok.dir, "packages", "b", ".npmrc", "inner"), "utf8"), "x");
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

test("every tree the install cannot keep inside the workspace is refused before pnpm runs", (t) => {
  const { outside, run } = harness(t);
  const refused = [
    [
      "a symlinked root node_modules",
      (dir) => symlinkSync(outside, path.join(dir, "node_modules")),
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
      (dir) => symlinkSync(outside, path.join(dir, "packages", "other")),
      /packages\/other is a symbolic link that resolves outside the workspace/,
    ],
    [
      "a link that resolves nowhere",
      (dir) => symlinkSync("nowhere", path.join(dir, "dangling")),
      /does not resolve/,
    ],
    [
      "a link into .git",
      (dir) => symlinkSync(".git", path.join(dir, "meta")),
      /symbolic link into the repository's \.git/,
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
    ["no workspace file", (dir) => rmSync(path.join(dir, "pnpm-workspace.yaml")), /pnpm-workspace\.yaml is missing/],
    ["no lockfile", (dir) => rmSync(path.join(dir, "pnpm-lock.yaml")), /pnpm-lock\.yaml is missing/],
    [
      "a lockfile importer that climbs out of the root",
      (dir) => setLockfile(dir, "  packages/b: {}", "  ../outside: {}"),
      /names a project that is not a plain path under the workspace root: \.\.\/outside/,
    ],
    [
      "a lockfile importer that climbs out from inside a path",
      (dir) => setLockfile(dir, "  packages/b: {}", "  packages/../../outside: {}"),
      /names a project that is not a plain path/,
    ],
    [
      "an absolute lockfile importer",
      (dir) => setLockfile(dir, "  packages/b: {}", `  '${outside}': {}`),
      /names a project that is not a plain path/,
    ],
    [
      "lockfile importers in flow style",
      (dir) => writeFileSync(path.join(dir, "pnpm-lock.yaml"), "importers: {.: {}, ../outside: {}}\n"),
      /does not list its importers in block form/,
    ],
    [
      "a lockfile with no importers",
      (dir) => writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
      /lists no importers/,
    ],
    [
      "a linked package outside the root",
      (dir) => setLockfile(dir, "version: link:../b", "version: link:../../../outside"),
      /names a local package outside the workspace root: link:\.\.\/\.\.\/\.\.\/outside/,
    ],
    [
      "a linked package that would be inside from the root but is outside from its importer",
      (dir) => setLockfile(dir, "version: link:../b", "version: link:../../.."),
      /names a local package outside the workspace root: link:\.\.\/\.\.\/\.\./,
    ],
    [
      "a file dependency outside the root",
      (dir) => setLockfile(dir, "version: link:packages/a", "version: file:../outside/dep.tgz"),
      /names a local package outside the workspace root: file:/,
    ],
    [
      "an absolute file dependency",
      (dir) => setLockfile(dir, "version: link:packages/a", `version: file:${outside}`),
      /names a local package outside the workspace root: file:/,
    ],
    [
      "a directory resolution outside the root",
      (dir) =>
        writeFileSync(
          path.join(dir, "pnpm-lock.yaml"),
          `${LOCKFILE}\npackages:\n\n  dep@1.0.0:\n    resolution: {directory: ../outside, type: directory}\n`,
        ),
      /names a local package outside the workspace root: directory:/,
    ],
    [
      "a lockfile with an escape in it",
      (dir) => setLockfile(dir, "version: link:../b", 'version: "link:\\u002e\\u002e/../../outside"'),
      /contains a backslash/,
    ],
    [
      "a lockfile with an anchor and an alias",
      (dir) => setLockfile(dir, "version: link:../b", "version: &up link:../b\n      c:\n        version: *up"),
      /uses a YAML anchor, alias or tag/,
    ],
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
    ...[
      "onlyBuiltDependencies",
      "onlyBuiltDependenciesFile",
      "neverBuiltDependencies",
      "patchedDependencies",
      "configDependencies",
      "executionEnv",
      "packageExtensions",
    ].map((key) => [
      `package.json setting pnpm.${key}`,
      (dir) => setManifest(dir, (m) => (m.pnpm = { overrides: {}, [key]: {} })),
      new RegExp(`package\\.json sets pnpm\\.${key};.*needs a person`),
    ]),
    [
      "a pnpm field that is not an object",
      (dir) => setManifest(dir, (m) => (m.pnpm = ["overrides"])),
      /"pnpm" field of package\.json is not an object/,
    ],
  ];
  for (const [name, setup, message] of refused) {
    const r = run(setup);
    assert.notEqual(r.status, 0, `${name}: the install did not fail`);
    assert.match(r.err, message, name);
    assert.match(r.err, /^::error::install-deps: /m, name);
    assert.equal(r.installed, false, `${name}: pnpm install was reached`);
    assert.equal(existsSync(path.join(r.dir, "node_modules", ".pnpm")), false, name);
  }
  // Nothing was written to the directory the links and paths pointed at.
  assert.deepEqual(readdirSync(outside), ["keep"]);
});

test("a pnpm on PATH that is not the pinned version is refused before the install", (t) => {
  const { run } = harness(t);
  const r = run(null, { STUB_VERSION: "9.15.4" });
  assert.notEqual(r.status, 0);
  assert.match(r.err, new RegExp(`^::error::install-deps: the pnpm on PATH is 9\\.15\\.4; .*pnpm ${PNPM_VERSION.replaceAll(".", "\\.")}`, "m"));
  assert.equal(r.installed, false);
});

test("after the install, anything that left the workspace fails the step", (t) => {
  const { outside, run } = harness(t);
  // Something appearing beside the workspace.
  const beside = run(null, { STUB_EXTRA: "mkdir ../sibling" });
  assert.equal(beside.installed, true);
  assert.notEqual(beside.status, 0);
  assert.match(beside.err, /^::error::install-deps: the install created or removed something beside the workspace/m);

  // A project's node_modules that became a link.
  const linked = run(null, { STUB_EXTRA: `ln -s ${outside} packages/a/node_modules` });
  assert.notEqual(linked.status, 0);
  assert.match(linked.err, /packages\/a\/node_modules is a symbolic link after the install/);

  // An installed entry, scoped or not, that resolves outside.
  for (const entry of ["dep", "@scope/dep"]) {
    const escaped = run(null, { STUB_EXTRA: `mkdir -p node_modules/@scope && ln -s ${outside} node_modules/${entry}` });
    assert.notEqual(escaped.status, 0, entry);
    assert.match(escaped.err, /resolves outside the workspace after the install/, entry);
  }
});

test("a failing pnpm fails the step and the branch's .npmrc still comes back", (t) => {
  const { run } = harness(t);
  const r = run((dir) => writeFileSync(path.join(dir, ".npmrc"), "branch=1\n"), { STUB_EXIT: "7" });
  assert.equal(r.status, 7);
  assert.equal(readFileSync(path.join(r.dir, ".npmrc"), "utf8"), "branch=1\n");
});

test("with the real pnpm: nothing the branch wrote runs, and the install stays inside", (t) => {
  // THE STUB CANNOT SHOW THIS. It records the flags; only pnpm itself shows
  // that under those flags a lifecycle script, a pnpmfile and a `.npmrc` that
  // moves the modules directory all come to nothing. Needs the pinned pnpm on
  // PATH — CI's `verify-self` job has it — and no network: the tree depends
  // only on its own workspace packages.
  const probe = spawnSync("pnpm", ["--version"], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: { ...process.env, npm_config_manage_package_manager_versions: "false" },
  });
  if (probe.status !== 0 || probe.stdout.trim() !== PNPM_VERSION) {
    t.skip(`needs pnpm ${PNPM_VERSION} on PATH (found ${probe.stdout?.trim() || "none"})`);
    return;
  }
  const base = mkdtempSync(path.join(os.tmpdir(), "install-deps-real-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  // The workspace sits in a directory of its own, so that anything appearing
  // beside it is the install's doing.
  const dir = path.join(base, "area", "ws");
  const marks = path.join(base, "marks");
  mkdirSync(marks);
  const mark = (name) => `node -e "require('fs').writeFileSync(process.env.MARKS + '/${name}', '')"`;
  mkdirSync(path.join(dir, "packages", "a"), { recursive: true });
  mkdirSync(path.join(dir, "packages", "b"), { recursive: true });
  mkdirSync(path.join(dir, ".git"));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      ...MANIFEST,
      devDependencies: { a: "workspace:*" },
      scripts: { preinstall: mark("root-preinstall"), postinstall: mark("root-postinstall"), prepare: mark("root-prepare") },
    }),
  );
  writeFileSync(
    path.join(dir, "packages", "a", "package.json"),
    JSON.stringify({ name: "a", version: "1.0.0", dependencies: { b: "workspace:*" }, scripts: { postinstall: mark("a-postinstall") } }),
  );
  writeFileSync(path.join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "b", version: "1.0.0" }));
  writeFileSync(path.join(dir, "pnpm-workspace.yaml"), TRUSTED_WORKSPACE);
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), LOCKFILE);
  writeFileSync(path.join(dir, ".npmrc"), "modules-dir=../moved\nvirtual-store-dir=../moved-store\n");
  writeFileSync(
    path.join(dir, ".pnpmfile.cjs"),
    "require('fs').writeFileSync(process.env.MARKS + '/pnpmfile', ''); module.exports = { hooks: {} };\n",
  );

  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "true",
      GITHUB_WORKSPACE: dir,
      MARKS: marks,
      HOME: path.join(base, "home"),
      PNPM_HOME: path.join(base, "home", "pnpm"),
      XDG_DATA_HOME: path.join(base, "home", "data"),
      XDG_CACHE_HOME: path.join(base, "home", "cache"),
      XDG_STATE_HOME: path.join(base, "home", "state"),
    },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(marks), [], "something the branch wrote was executed");
  assert.ok(existsSync(path.join(dir, "node_modules", "a")), "the root project was not installed");
  assert.ok(existsSync(path.join(dir, "packages", "a", "node_modules", "b")), "a workspace project was not installed");
  assert.deepEqual(readdirSync(path.join(base, "area")), ["ws"], "the install wrote beside the workspace");
  assert.equal(readFileSync(path.join(dir, ".npmrc"), "utf8"), "modules-dir=../moved\nvirtual-store-dir=../moved-store\n");
});

test("the copies beside the script are main's own files, and the pins are this repository's", () => {
  // RUNS ON EVERY PULL REQUEST that touches either side: `scripts/agent/**`
  // selects this lane, and a root `package.json`, `pnpm-workspace.yaml` or
  // `.npmrc` is unclassified in `harness.config.json`, which forces every lane.
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
