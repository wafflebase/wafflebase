import { describe, it, expect } from 'vitest';
import {
  SYSTEM_FONTS,
  isFontRoleSelected,
  makeFamilyFont,
  makeRoleFont,
} from "@/app/slides/themed-font-picker-helpers.ts";

/**
 * The themed font picker UI is a `.tsx` React component. Helper logic —
 * system-font list, role-vs-family selection detection, ThemeFont
 * builders — is extracted to `themed-font-picker-helpers.ts` and tested
 * here without rendering React.
 */

describe("themed-font-picker helpers", () => {
  it("SYSTEM_FONTS has at least 8 entries including Inter and Roboto", () => {
    expect(SYSTEM_FONTS.length >= 8).toBeTruthy();
    expect(SYSTEM_FONTS.includes("Inter")).toBeTruthy();
    expect(SYSTEM_FONTS.includes("Roboto")).toBeTruthy();
  });

  it("isFontRoleSelected returns true only when value is a role match", () => {
    expect(isFontRoleSelected({ kind: "role", role: "heading" }, "heading")).toBeTruthy();
    expect(!isFontRoleSelected({ kind: "role", role: "heading" }, "body")).toBeTruthy();
    // family values never match a role button.
    expect(!isFontRoleSelected({ kind: "family", family: "Inter" }, "heading")).toBeTruthy();
    expect(!isFontRoleSelected(undefined, "heading")).toBeTruthy();
  });

  it("makeRoleFont produces a role ThemeFont for both roles", () => {
    expect(makeRoleFont("heading")).toEqual({
      kind: "role",
      role: "heading",
    });
    expect(makeRoleFont("body")).toEqual({ kind: "role", role: "body" });
  });

  it("makeFamilyFont produces a family ThemeFont", () => {
    expect(makeFamilyFont("Inter")).toEqual({
      kind: "family",
      family: "Inter",
    });
  });
});
