import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CORE_PACKAGE, importCoreDep, resolveCoreDep } from "./core-deps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_DIR = path.dirname(fileURLToPath(CORE_PACKAGE));

/** What Node's own ESM resolver answers for `name`, asked from `scripts/agent`. */
function nodeResolves(name) {
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", "process.stdout.write(import.meta.resolve(process.argv[1]))", name],
    { cwd: CORE_DIR, encoding: "utf8" },
  );
  return r.status === 0 ? r.stdout : null;
}

// --- the one copy -------------------------------------------------------------

for (const name of ["@anthropic-ai/claude-agent-sdk", "zod"]) {
  test(`${name} resolves to the file the core's own import loads (skipped without the install)`, async (t) => {
    // The reason this module exists: the hunters build an MCP server with the
    // SDK and hand it to `ask.mjs`, which runs it with ITS import of the SDK.
    // One file URL is one module instance. zod is the case a `require.resolve`
    // gets wrong — its `require` export is the CommonJS build.
    const expected = nodeResolves(name);
    if (expected === null) {
      t.skip("scripts/agent/node_modules is not installed (expected in the agent-arms:tests lane)");
      return;
    }
    assert.equal(resolveCoreDep(name), expected);
    const mod = await importCoreDep(name);
    assert.equal(mod, await import(expected), "the same module instance");
  });
}

// --- Node's answer, on every package shape -------------------------------------
//
// This is what CI proves, where `scripts/agent/node_modules` is absent: on a
// fixture install of every shape a package can take, the helper answers what
// Node's own resolver answers when asked from the core's directory — the same
// file, and so the same module instance — or fails with the same code. The
// test above then only has to show that the real install is asked from where
// `ask.mjs` lives, which the test below this one does without the install.

/** Node's answer for each name, asked from `cwd` by a fresh process. */
function nodeAnswers(cwd, names) {
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const out = {};
       for (const n of process.argv.slice(1)) {
         try { out[n] = { url: import.meta.resolve(n) }; } catch (e) { out[n] = { code: e.code }; }
       }
       process.stdout.write(JSON.stringify(out));`,
      ...names,
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("every package shape resolves to Node's own answer from the core's directory", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "core-deps-"));
  const core = path.join(root, "repo", "scripts", "agent");
  mkdirSync(core, { recursive: true });
  writeFileSync(path.join(core, "package.json"), JSON.stringify({ type: "module" }));
  const put = (dir, manifest, files) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      writeFileSync(path.join(dir, f), body);
    }
  };
  const near = (name) => path.join(core, "node_modules", name);
  const ESM = "export const id = Symbol();\n";
  const CJS = "module.exports = { id: Symbol() };\n";
  put(near("both"), { exports: { types: "./t.d.ts", import: "./esm.mjs", require: "./cjs.cjs" } }, { "esm.mjs": ESM, "cjs.cjs": CJS });
  put(near("req-first"), { exports: { require: "./cjs.cjs", default: "./d.mjs" } }, { "cjs.cjs": CJS, "d.mjs": ESM });
  put(near("module-sync"), { exports: { ".": { "module-sync": "./sync.mjs", import: "./imp.mjs" } } }, { "sync.mjs": ESM, "imp.mjs": ESM });
  put(near("node-addons"), { exports: { "node-addons": "./a.mjs", default: "./d.mjs" } }, { "a.mjs": ESM, "d.mjs": ESM });
  put(near("nested"), { exports: { ".": { node: { import: "./n.mjs", default: "./n.cjs" } }, "./x": "./x.mjs" } }, { "n.mjs": ESM, "n.cjs": CJS, "x.mjs": ESM });
  put(near("plain"), { exports: "./p.mjs" }, { "p.mjs": ESM });
  put(near("array"), { exports: [{ worker: "./w.mjs" }, "./a.mjs"] }, { "w.mjs": ESM, "a.mjs": ESM });
  put(near("main-file"), { main: "lib/m.js" }, { "lib/m.js": CJS });
  put(near("main-no-ext"), { main: "./entry" }, { "entry.js": CJS });
  put(near("main-dir"), { main: "lib" }, { "lib/index.js": CJS });
  put(near("no-main"), {}, { "index.js": CJS });
  put(near("@scope/pkg"), { exports: { default: "./s.mjs" } }, { "s.mjs": ESM });
  put(near("require-only"), { exports: { require: "./c.cjs" } }, { "c.cjs": CJS });
  // A symlinked install (pnpm's layout): Node answers with the real path.
  const store = path.join(core, "node_modules", ".pnpm", "linked@1", "node_modules", "linked");
  put(store, { exports: { import: "./e.mjs" } }, { "e.mjs": ESM });
  symlinkSync(store, near("linked"), "dir");
  // Lookup order: the nearest node_modules above the core wins.
  put(path.join(root, "repo", "node_modules", "hoisted"), { exports: "./up.mjs" }, { "up.mjs": ESM });
  put(path.join(root, "repo", "node_modules", "shadowed"), { exports: "./up.mjs" }, { "up.mjs": ESM });
  put(near("shadowed"), { exports: "./near.mjs" }, { "near.mjs": ESM });
  const names = [
    "both", "req-first", "module-sync", "node-addons", "nested", "plain", "array",
    "main-file", "main-no-ext", "main-dir", "no-main", "@scope/pkg", "require-only",
    "linked", "hoisted", "shadowed", "absent-package-for-this-test",
  ];
  try {
    const node = nodeAnswers(core, names);
    const corePackage = pathToFileURL(path.join(core, "package.json"));
    let resolved = 0;
    for (const name of names) {
      let mine;
      try {
        mine = { url: resolveCoreDep(name, { corePackage }) };
      } catch (e) {
        mine = { code: e.code };
      }
      assert.deepEqual(mine, node[name], name);
      if (mine.url) {
        resolved++;
        assert.equal(await importCoreDep(name, { corePackage }), await import(node[name].url), `${name}: the same module instance`);
      }
    }
    assert.ok(resolved >= 15, `only ${resolved} shapes resolved — the fixture is not what it says`);
    assert.equal(node["module-sync"].url.endsWith("/sync.mjs"), true, "this Node does not apply module-sync — the case tests nothing here");
    assert.equal(node["absent-package-for-this-test"].code, "ERR_MODULE_NOT_FOUND");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real install is asked from the directory ask.mjs lives in", () => {
  // `ask.mjs` runs the hunters' MCP server with ITS `import()` of the SDK, which
  // Node resolves from `ask.mjs`'s directory. Anchoring there (with the test above)
  // is what makes the helper's answer the same file — no install needed to see it.
  const askDir = path.dirname(fileURLToPath(new URL("../agent/ask.mjs", import.meta.url)));
  assert.equal(path.dirname(fileURLToPath(CORE_PACKAGE)), askDir);
  assert.equal(path.dirname(fileURLToPath(CORE_PACKAGE)), CORE_DIR);
  assert.match(readFileSync(path.join(askDir, "ask.mjs"), "utf8"), /\bimport\(\s*["']@anthropic-ai\/claude-agent-sdk["']\s*\)/, "ask.mjs no longer imports the SDK by name");
});

test("the resolve hook acts only while the helper is resolving", () => {
  // Registered process-wide on first use, so it must leave every other
  // resolution alone: after the helper found a package, the same name asked
  // from here — where nothing is installed — is still not found.
  // Real path: Node answers with one, and the temp directory may be a link.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "core-deps-")));
  const core = path.join(root, "scripts", "agent");
  const pkg = path.join(core, "node_modules", "only-in-the-fixture");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(path.join(core, "package.json"), "{}");
  writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ exports: "./i.mjs" }));
  writeFileSync(path.join(pkg, "i.mjs"), "export {};\n");
  try {
    const corePackage = pathToFileURL(path.join(core, "package.json"));
    assert.equal(resolveCoreDep("only-in-the-fixture", { corePackage }), pathToFileURL(path.join(pkg, "i.mjs")).href);
    assert.throws(() => import.meta.resolve("only-in-the-fixture"), { code: "ERR_MODULE_NOT_FOUND" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only a bare package name is taken", () => {
  for (const bad of ["zod/v4", "./x.mjs", "../agent/ask.mjs", "/abs", "node:fs", "", "@scope", "@scope/pkg/sub"]) {
    assert.throws(() => resolveCoreDep(bad), TypeError, bad);
  }
});

// --- the invariant the arms lane depends on -----------------------------------

test("no module under scripts/agent-arms loads a third-party package except through core-deps.mjs", () => {
  // Two rules, and the lane needs both. A STATIC third-party import makes the
  // file — and every file importing it — fail to load in `agent-arms:tests`,
  // which runs with `scripts/agent/node_modules` absent. A bare DYNAMIC
  // `import("pkg")` loads, but resolves from this directory, where nothing is
  // installed: it would fail at the one call that needed it, in a real run.
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      if (e.name === "node_modules" || e.name.startsWith(".")) return [];
      const full = path.join(d, e.name);
      return e.isDirectory() ? walk(full) : /\.(mjs|js|cjs)$/.test(e.name) ? [full] : [];
    });
  const files = walk(HERE);
  assert.ok(files.length > 10, "expected to find the arm modules");

  const WITH_FROM = /^\s*(?:import|export)\b[^;]*?\sfrom\s+["']([^"']+)["']/gm;
  const SIDE_EFFECT = /^\s*import\s+["']([^"']+)["']/gm;
  const DYNAMIC = /\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  const REQUIRE = /\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  const isLocal = (spec) => spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("node:");
  const offenders = [];
  let dynamicSeen = 0;
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // Comment lines name `import('playwright')` to explain why it is not done.
    const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const re of [WITH_FROM, SIDE_EFFECT, DYNAMIC, REQUIRE]) {
      for (const m of code.matchAll(re)) {
        if (re === DYNAMIC) dynamicSeen++;
        if (!isLocal(m[1])) offenders.push(`${path.relative(HERE, file)} → ${m[1]}`);
      }
    }
  }
  assert.ok(dynamicSeen > 0, "found no dynamic imports at all — the scan is not reading what it should");
  assert.deepEqual(
    offenders,
    [],
    "third-party import(s) found; load them with `importCoreDep(name)` from ./core-deps.mjs:\n  " +
      offenders.join("\n  "),
  );
});
