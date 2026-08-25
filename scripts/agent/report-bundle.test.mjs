// The pipeline's half of a two-sided contract.
//
// `validateBundle` here and `parseBundle` in `packages/debug-report` validate the
// same format and cannot share code — `scripts/agent/` is a separate npm install
// outside the pnpm workspace. So both suites read the SAME fixtures, and a rule
// that changes on one side and not the other goes red instead of silently
// accepting a bundle the other half rejects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLE_SCHEMA,
  bundlePath,
  bundlePaths,
  captureFiles,
  missingCaptures,
  readBundle,
  validateBundle,
} from "./report-bundle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures", "debug-report");

const valid = () => JSON.parse(readFileSync(path.join(FIXTURES, "bundle-valid.json"), "utf8"));

test("the shared valid fixture is accepted", () => {
  const result = validateBundle(valid());
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join("; "));
  assert.equal(result.bundle.items.length, 3);
});

test("every shared invalid fixture is refused, and says why", () => {
  const dir = path.join(FIXTURES, "invalid");
  const names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  // A guard against the fixtures quietly disappearing: an empty sweep would
  // otherwise pass this test while asserting nothing at all.
  assert.ok(names.length >= 6, `expected the invalid fixtures, found ${names.length}`);
  for (const name of names) {
    const parsed = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    const result = validateBundle(parsed);
    assert.equal(result.ok, false, `${name} should have been refused`);
    assert.ok(result.errors.length > 0, `${name} was refused with no reason`);
  }
});

test("a version skew is reported alone, not buried in field noise", () => {
  const result = validateBundle({ ...valid(), schema: BUNDLE_SCHEMA + 1 });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /bundle\.schema/);
});

test("an empty item list is refused — there is nothing to act on", () => {
  const result = validateBundle({ ...valid(), items: [] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /at least one item/);
});

test("an absent build SHA is allowed; a blank one is not", () => {
  const withoutSha = valid();
  delete withoutSha.env.buildSha;
  assert.equal(validateBundle(withoutSha).ok, true);
  const blank = valid();
  blank.env.buildSha = "";
  assert.equal(validateBundle(blank).ok, false);
});

test("a draft with an unknown kind is refused, because the kind routes the PR", () => {
  const bundle = valid();
  bundle.items[0].draft.kind = "vibes";
  const result = validateBundle(bundle);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /draft\.kind/);
});

test("readBundle reports a missing or unreadable file rather than throwing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wb-bundle-"));
  assert.equal(readBundle(path.join(dir, "nope")).ok, false);
  writeFileSync(path.join(dir, "bundle.json"), "{ truncated");
  const result = readBundle(dir);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /not valid JSON/);
});

test("readBundle accepts a directory or the file itself", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wb-bundle-"));
  const file = path.join(dir, "bundle.json");
  writeFileSync(file, JSON.stringify(valid()));
  assert.equal(readBundle(dir).ok, true);
  assert.equal(readBundle(file).ok, true);
});

test("captures are read from the DIRECTORY, not trusted from the bundle", () => {
  // The bundle says which images should be there; the difference between that
  // and what is on disk is something the pipeline has to be able to report.
  const dir = mkdtempSync(path.join(tmpdir(), "wb-bundle-"));
  writeFileSync(path.join(dir, "cap-1.jpg"), "bytes");
  writeFileSync(path.join(dir, "notes.txt"), "ignored");
  assert.deepEqual(Object.keys(captureFiles(dir)), ["cap-1"]);
  assert.deepEqual(captureFiles(path.join(dir, "nope")), {});
});

test("missingCaptures names the report whose evidence is absent", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wb-bundle-"));
  const bundle = valid();
  assert.deepEqual(
    missingCaptures(bundle, dir).map((m) => m.capture),
    ["cap-1"],
  );
  writeFileSync(path.join(dir, "cap-1.jpg"), "bytes");
  assert.deepEqual(missingCaptures(bundle, dir), []);
});

test("bundlePaths takes the newest handover, and counts past nine", () => {
  // A session hands over more than once, so the endpoint writes `bundle.json`,
  // `bundle-2.json`, … rather than overwriting. Lexical order puts
  // `bundle-10.json` before `bundle-2.json`, which would make a tenth handover
  // read as the oldest.
  const dir = mkdtempSync(path.join(tmpdir(), "wb-bundles-"));
  for (const name of ["bundle.json", "bundle-2.json", "bundle-10.json", "notes.txt"]) {
    writeFileSync(path.join(dir, name), "{}");
  }
  assert.deepEqual(
    bundlePaths(dir).map((f) => path.basename(f)),
    ["bundle-10.json", "bundle-2.json", "bundle.json"],
  );
  assert.equal(path.basename(bundlePath(dir)), "bundle-10.json");
});

test("bundlePaths passes a file through and answers nothing for a missing path", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wb-bundles-"));
  const file = path.join(dir, "elsewhere.json");
  writeFileSync(file, "{}");
  assert.deepEqual(bundlePaths(file), [file]);
  assert.deepEqual(bundlePaths(path.join(dir, "nope")), []);
  assert.equal(bundlePath(path.join(dir, "nope")), null);
});
