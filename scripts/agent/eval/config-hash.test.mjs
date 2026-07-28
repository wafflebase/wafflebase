import { test } from "node:test";
import assert from "node:assert/strict";
import { configHash, contentHash, canonicalConfig } from "./config-hash.mjs";

const baseLens = {
  id: "correctness",
  title: "Correctness",
  model: "claude-opus-4-8",
  samples: 2,
  gating: "blocking",
  needsIssueSpec: false,
  appliesWhen: ["**"],
  rubric_sha256: "sha256:aaa",
};
const base = {
  schema_version: 1,
  config_id: "baseline-opus-s2",
  target: "reviewer",
  description: "baseline",
  sdk_version: "0.3.217",
  lenses: [
    { ...baseLens },
    { ...baseLens, id: "security", title: "Security", rubric_sha256: "sha256:bbb" },
  ],
};

test("same judge, lenses in different order → same hash", () => {
  const reordered = { ...base, lenses: [base.lenses[1], base.lenses[0]] };
  assert.equal(configHash(base), configHash(reordered));
});

test("appliesWhen order does not affect identity (it is a set)", () => {
  const a = { ...base, lenses: [{ ...baseLens, appliesWhen: ["a", "b"] }] };
  const b = { ...base, lenses: [{ ...baseLens, appliesWhen: ["b", "a"] }] };
  assert.equal(configHash(a), configHash(b));
});

test("omitted default hashes identically to explicit default", () => {
  const explicit = { ...base, lenses: [{ ...baseLens }] };
  const omitted = {
    ...base,
    lenses: [{ id: "correctness", title: "Correctness", model: "claude-opus-4-8", rubric_sha256: "sha256:aaa" }],
    // samples/gating/needsIssueSpec/appliesWhen omitted → panel defaults
  };
  assert.equal(configHash(explicit), configHash(omitted));
});

test("excluded fields (config_id, description, sdk_version, schema_version) do NOT change identity", () => {
  const h = configHash(base);
  assert.equal(configHash({ ...base, config_id: "renamed" }), h);
  assert.equal(configHash({ ...base, description: "different" }), h);
  assert.equal(configHash({ ...base, sdk_version: "9.9.9" }), h);
  assert.equal(configHash({ ...base, schema_version: 99 }), h);
});

test("changing a behavior field DOES change identity", () => {
  const h = configHash(base);
  assert.notEqual(configHash({ ...base, target: "fixer" }), h);
  assert.notEqual(configHash({ ...base, lenses: [{ ...baseLens, model: "claude-haiku-4-5" }, base.lenses[1]] }), h);
  assert.notEqual(configHash({ ...base, lenses: [{ ...baseLens, samples: 3 }, base.lenses[1]] }), h);
  assert.notEqual(configHash({ ...base, lenses: [{ ...baseLens, gating: "advisory" }, base.lenses[1]] }), h);
  assert.notEqual(configHash({ ...base, lenses: [{ ...baseLens, rubric_sha256: "sha256:zzz" }, base.lenses[1]] }), h);
});

test("configHash is prefixed and deterministic", () => {
  assert.match(configHash(base), /^sha256:[0-9a-f]{64}$/);
  assert.equal(configHash(base), configHash(base));
});

test("canonicalConfig omits excluded fields entirely", () => {
  const c = canonicalConfig(base);
  assert.ok(!c.includes("baseline-opus-s2"));
  assert.ok(!c.includes("0.3.217"));
  assert.ok(c.includes("reviewer"));
});

test("contentHash is deterministic and prefixed", () => {
  assert.equal(contentHash("hello"), contentHash("hello"));
  assert.notEqual(contentHash("hello"), contentHash("world"));
  assert.match(contentHash("x"), /^sha256:[0-9a-f]{64}$/);
});
