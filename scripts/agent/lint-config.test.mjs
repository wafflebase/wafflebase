// The lint config lints ITSELF — because a config that lints nothing reports success.
//
// `eslint.config.mjs` spreads `js.configs.recommended` and then sets `rules` for one
// override. The first version of that spread OVERWROTE the recommended rules
// wholesale, leaving `no-undef` — the rule the whole config exists for — disabled.
// `eslint scripts` still exited 0, so the only symptom was silence.
//
// EVERY IMPORT OF THE CONFIG IS DYNAMIC, and that is not stylistic. `agent:tests`
// runs with `scripts/agent/node_modules` ABSENT (see ask.test.mjs's third-party
// import invariant), and the config legitimately needs `@eslint/js` and `globals`.
// A static import would make this file's dependencies the whole lane's, so they are
// loaded inside the tests and their absence SKIPS rather than fails — the same shape
// as the SDK-dependent probe test elsewhere in this suite.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(HERE, "..", "..", "eslint.config.mjs");

/** The resolved scripts entry plus upstream's recommended rules, or null. */
async function load() {
  try {
    const [{ default: config }, { default: js }] = await Promise.all([
      import(CONFIG),
      import("@eslint/js"),
    ]);
    const entry = config.find((c) => (c.files ?? []).some((f) => f.includes("scripts")));
    return entry ? { entry, recommended: js.configs.recommended.rules } : null;
  } catch {
    return null; // eslint not installed — see the header
  }
}
const SKIP = "eslint not installed (expected without a root workspace install)";

test("the scripts lint config claims scripts/**/*.mjs and nothing else", async (t) => {
  const l = await load();
  if (!l) return t.skip(SKIP);
  assert.ok(l.entry.files.includes("scripts/**/*.mjs"));
  // Not the TypeScript packages — they have their own configs and their own rules.
  assert.ok(!l.entry.files.some((f) => f.includes(".ts")), "must not claim the TS packages");
});

test("no-undef is ENABLED — the rule #657's undeclared identifier needed", async (t) => {
  const l = await load();
  if (!l) return t.skip(SKIP);
  // The single assertion that would have failed on the broken spread.
  assert.equal(l.entry.rules["no-undef"], "error");
});

test("every recommended rule survives the local override", async (t) => {
  const l = await load();
  if (!l) return t.skip(SKIP);
  // A spread that replaces rather than merges silently drops all of them. Comparing
  // against the upstream set also means a future ESLint release that ADDS a
  // recommended rule is inherited rather than quietly missed.
  for (const [rule, level] of Object.entries(l.recommended)) {
    if (rule === "no-unused-vars") continue; // deliberately re-configured below
    assert.equal(l.entry.rules[rule], level, `${rule} was dropped or downgraded`);
  }
});

test("no-unused-vars keeps the underscore convention, and stays an error", async (t) => {
  const l = await load();
  if (!l) return t.skip(SKIP);
  const [level, opts] = l.entry.rules["no-unused-vars"];
  assert.equal(level, "error");
  assert.equal(opts.argsIgnorePattern, "^_");
});

test("node globals are declared, or no-undef is pure noise", async (t) => {
  const l = await load();
  if (!l) return t.skip(SKIP);
  // These scripts are Node CLIs. Without the globals every `process`/`console` is an
  // undefined reference — the state in which someone switches the rule off and loses
  // the signal for good.
  for (const g of ["process", "console", "URL", "setTimeout", "Buffer"]) {
    assert.ok(g in l.entry.languageOptions.globals, `missing Node global: ${g}`);
  }
  assert.equal(l.entry.languageOptions.sourceType, "module");
});
