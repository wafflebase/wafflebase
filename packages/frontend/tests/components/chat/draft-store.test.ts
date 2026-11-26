import { afterEach, describe, expect, it, vi } from "vitest";
import { draftStore } from "@/components/chat/draft-store";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("draftStore", () => {
  it("round-trips a draft per user and channel", () => {
    draftStore.set(1, "c1", "half a thought");
    draftStore.set(1, "c2", "another");
    expect(draftStore.get(1, "c1")).toBe("half a thought");
    expect(draftStore.get(1, "c2")).toBe("another");
    expect(window.sessionStorage.getItem("wafflebase:chat-draft:1:c1")).toBe(
      "half a thought",
    );
  });

  it("keeps one user's draft from another signing in to the same tab", () => {
    draftStore.set(1, "c1", "mine");
    expect(draftStore.get(2, "c1")).toBe("");
    expect(draftStore.get(1, "c1")).toBe("mine");
  });

  it("stores nothing while nobody is signed in", () => {
    draftStore.set(undefined, "c1", "x");
    expect(window.sessionStorage.length).toBe(0);
    expect(draftStore.get(undefined, "c1")).toBe("");
  });

  it("never adopts a draft saved before drafts were keyed by user, and drops it", () => {
    window.sessionStorage.setItem("wafflebase:chat-draft:c1", "whose?");
    expect(draftStore.get(1, "c1")).toBe("");
    draftStore.dropLegacy("c1");
    expect(window.sessionStorage.getItem("wafflebase:chat-draft:c1")).toBeNull();
  });

  it("clears a draft, and an empty set clears it too", () => {
    draftStore.set(1, "c1", "x");
    draftStore.clear(1, "c1");
    expect(draftStore.get(1, "c1")).toBe("");
    draftStore.set(1, "c1", "y");
    draftStore.set(1, "c1", "");
    expect(window.sessionStorage.getItem("wafflebase:chat-draft:1:c1")).toBeNull();
  });

  it("survives a sessionStorage that throws on every access", () => {
    const boom = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);

    expect(() => draftStore.set(1, "c1", "x")).not.toThrow();
    expect(draftStore.get(1, "c1")).toBe("");
    expect(() => draftStore.clear(1, "c1")).not.toThrow();
    expect(() => draftStore.dropLegacy("c1")).not.toThrow();
  });
});
