import { describe, expect, it } from "vitest";
import { avatarInitials } from "@/components/avatar-size";

/**
 * One initials rule for every avatar of a person. The sidebar used word
 * initials while the presence stack, documents list and notification rows
 * took the first two letters, so the same user read as "H" and "HA".
 */
describe("avatarInitials", () => {
  it("takes the first letter of a single-word login", () => {
    expect(avatarInitials("hackerwins")).toBe("H");
  });

  it("takes the first letter of up to two words", () => {
    expect(avatarInitials("Youngteac Hong")).toBe("YH");
    expect(avatarInitials("ada king lovelace")).toBe("AK");
  });

  it("splits logins on underscores and hyphens", () => {
    expect(avatarInitials("jane_doe")).toBe("JD");
    expect(avatarInitials("jane-doe")).toBe("JD");
  });

  it("ignores leading and doubled separators", () => {
    expect(avatarInitials("_jane__doe")).toBe("JD");
    expect(avatarInitials("  bob ")).toBe("B");
  });

  it("keeps an astral first character whole", () => {
    expect(avatarInitials("𝒜lice")).toBe("𝒜");
  });

  it("falls back to a question mark for an empty name", () => {
    expect(avatarInitials("")).toBe("?");
    expect(avatarInitials("   ")).toBe("?");
  });
});
