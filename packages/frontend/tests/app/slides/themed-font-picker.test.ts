import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_FONTS,
  isFontRoleSelected,
  makeFamilyFont,
  makeRoleFont,
} from "@/app/slides/themed-font-picker-helpers.ts";

/**
 * The themed font picker UI is a `.tsx` React component, stubbed by
 * `tests/resolve-hooks.mjs` at test load. Helper logic — system-font
 * list, role-vs-family selection detection, ThemeFont builders — is
 * extracted to `themed-font-picker-helpers.ts` and tested here.
 */

describe("themed-font-picker helpers", () => {
  it("SYSTEM_FONTS has at least 8 entries including Inter and Roboto", () => {
    assert.ok(SYSTEM_FONTS.length >= 8);
    assert.ok(SYSTEM_FONTS.includes("Inter"));
    assert.ok(SYSTEM_FONTS.includes("Roboto"));
  });

  it("isFontRoleSelected returns true only when value is a role match", () => {
    assert.ok(
      isFontRoleSelected({ kind: "role", role: "heading" }, "heading"),
    );
    assert.ok(
      !isFontRoleSelected({ kind: "role", role: "heading" }, "body"),
    );
    // family values never match a role button.
    assert.ok(
      !isFontRoleSelected({ kind: "family", family: "Inter" }, "heading"),
    );
    assert.ok(!isFontRoleSelected(undefined, "heading"));
  });

  it("makeRoleFont produces a role ThemeFont for both roles", () => {
    assert.deepEqual(makeRoleFont("heading"), {
      kind: "role",
      role: "heading",
    });
    assert.deepEqual(makeRoleFont("body"), { kind: "role", role: "body" });
  });

  it("makeFamilyFont produces a family ThemeFont", () => {
    assert.deepEqual(makeFamilyFont("Inter"), {
      kind: "family",
      family: "Inter",
    });
  });
});
