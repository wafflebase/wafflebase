import { describe, expect, it } from "vitest";
import {
  normalizeChannelName,
  validChannelName,
} from "@/app/chat/channel-name";

describe("channel names", () => {
  it("normalizes like the server: trim, lower-case, spaces to dashes", () => {
    expect(normalizeChannelName("  Q4 Planning  ")).toBe("q4-planning");
    expect(normalizeChannelName("Design   Review")).toBe("design-review");
  });

  it("accepts letters, digits, Hangul, - and _", () => {
    expect(validChannelName("q4-planning")).toBe(true);
    expect(validChannelName("기획_회의")).toBe(true);
  });

  it("rejects a leading dash, punctuation and names over 80 characters", () => {
    expect(validChannelName("-general")).toBe(false);
    expect(validChannelName("gen!eral")).toBe(false);
    expect(validChannelName("")).toBe(false);
    expect(validChannelName("a".repeat(81))).toBe(false);
    expect(validChannelName("a".repeat(80))).toBe(true);
  });
});
