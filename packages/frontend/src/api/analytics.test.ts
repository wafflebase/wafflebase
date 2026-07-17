import { describe, it, expect, beforeEach, vi } from "vitest";
import { getVisitorId, newSessionId } from "./analytics";

describe("analytics id helpers", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
  });
  it("persists a stable visitor id across calls", () => {
    const a = getVisitorId();
    const b = getVisitorId();
    expect(a).toBe(b);
    expect(a).toMatch(/[0-9a-f-]{36}/);
  });
  it("mints a fresh session id each call", () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });
});
