import assert from "node:assert/strict";
import test from "node:test";
import { cn } from "../../src/lib/utils.ts";

test("cn merges optional classes", () => {
  assert.equal(cn("base", undefined, "active"), "base active");
});

test("cn deduplicates conflicting tailwind classes", () => {
  assert.equal(cn("p-2 p-4", "text-left", "text-right"), "p-4 text-right");
});
