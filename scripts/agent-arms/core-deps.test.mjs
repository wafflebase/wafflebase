import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// --- how a package is read ----------------------------------------------------

function fixture(packages) {
  const root = mkdtempSync(path.join(tmpdir(), "core-deps-"));
  const core = path.join(root, "repo", "scripts", "agent");
  mkdirSync(core, { recursive: true });
  writeFileSync(path.join(core, "package.json"), "{}");
  for (const [where, name, manifest] of packages) {
    const dir = path.join(root, where, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
  }
  return { root, corePackage: pathToFileURL(path.join(core, "package.json")) };
}

test("exports: the `.` entry, ESM conditions, first match in key order", () => {
  const { root, corePackage } = fixture([
    ["repo/scripts/agent", "both", { exports: { types: "./t.d.ts", import: "./esm.js", require: "./cjs.cjs" } }],
    ["repo/scripts/agent", "req-first", { exports: { require: "./cjs.cjs", default: "./d.js" } }],
    ["repo/scripts/agent", "nested", { exports: { ".": { node: { import: "./n.mjs", default: "./n.cjs" } }, "./x": "./x.js" } }],
    ["repo/scripts/agent", "plain", { exports: "./p.js" }],
    ["repo/scripts/agent", "array", { exports: [{ worker: "./w.js" }, "./a.js"] }],
    ["repo/scripts/agent", "legacy", { main: "lib/m.js" }],
    ["repo/scripts/agent", "bare", {}],
    ["repo/scripts/agent", "@scope/pkg", { exports: { default: "./s.js" } }],
    ["repo/scripts/agent", "cjs-only", { exports: { require: "./c.cjs" } }],
  ]);
  try {
    const at = (name, rel) => pathToFileURL(path.join(root, "repo/scripts/agent/node_modules", name, rel)).href;
    const r = (name) => resolveCoreDep(name, { corePackage });
    assert.equal(r("both"), at("both", "esm.js"));
    assert.equal(r("req-first"), at("req-first", "d.js"));
    assert.equal(r("nested"), at("nested", "n.mjs"));
    assert.equal(r("plain"), at("plain", "p.js"));
    assert.equal(r("array"), at("array", "a.js"));
    assert.equal(r("legacy"), at("legacy", "lib/m.js"));
    assert.equal(r("bare"), at("bare", "index.js"));
    assert.equal(r("@scope/pkg"), at("@scope/pkg", "s.js"));
    assert.throws(() => r("cjs-only"), { code: "ERR_MODULE_NOT_FOUND" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lookup: the nearest node_modules above the core wins; a missing package is ERR_MODULE_NOT_FOUND", () => {
  const { root, corePackage } = fixture([
    ["repo", "hoisted", { exports: "./up.js" }],
    ["repo", "shadowed", { exports: "./up.js" }],
    ["repo/scripts/agent", "shadowed", { exports: "./near.js" }],
  ]);
  try {
    const r = (name) => resolveCoreDep(name, { corePackage });
    assert.equal(r("hoisted"), pathToFileURL(path.join(root, "repo/node_modules/hoisted/up.js")).href);
    assert.equal(r("shadowed"), pathToFileURL(path.join(root, "repo/scripts/agent/node_modules/shadowed/near.js")).href);
    assert.throws(() => r("absent-package-for-this-test"), { code: "ERR_MODULE_NOT_FOUND" });
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
