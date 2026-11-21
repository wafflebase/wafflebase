import { afterEach, describe, expect, it, vi } from "vitest";
import { draftStore } from "@/components/chat/draft-store";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("draftStore", () => {
  it("round-trips a draft per channel", () => {
    draftStore.set("c1", "half a thought");
    draftStore.set("c2", "another");
    expect(draftStore.get("c1")).toBe("half a thought");
    expect(draftStore.get("c2")).toBe("another");
    expect(
      window.sessionStorage.getItem("wafflebase:chat-draft:c1"),
    ).toBe("half a thought");
  });

  it("clears a draft, and an empty set clears it too", () => {
    draftStore.set("c1", "x");
    draftStore.clear("c1");
    expect(draftStore.get("c1")).toBe("");
    draftStore.set("c1", "y");
    draftStore.set("c1", "");
    expect(window.sessionStorage.getItem("wafflebase:chat-draft:c1")).toBeNull();
  });

  it("survives a sessionStorage that throws on every access", () => {
    const boom = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);

    expect(() => draftStore.set("c1", "x")).not.toThrow();
    expect(draftStore.get("c1")).toBe("");
    expect(() => draftStore.clear("c1")).not.toThrow();
  });
});
