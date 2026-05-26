import { test, expect } from 'vitest';
import { cn } from "../../src/lib/utils.ts";

test("cn merges optional classes", () => {
  expect(cn("base", undefined, "active")).toBe("base active");
});

test("cn deduplicates conflicting tailwind classes", () => {
  expect(cn("p-2 p-4", "text-left", "text-right")).toBe("p-4 text-right");
});
