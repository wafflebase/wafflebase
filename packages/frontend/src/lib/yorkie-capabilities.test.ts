import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The gate exists because going durable on a build that cannot carry a client
 * key is worse than not going durable at all: the store fills with entries no
 * reload can use, and the chip promises a durability that does not survive
 * one.
 */

async function withVersion(version: string): Promise<boolean> {
  vi.stubGlobal("__YORKIE_REACT_VERSION__", version);
  vi.resetModules();
  const { supportsClientKey } = await import("./yorkie-capabilities");
  return supportsClientKey();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("client key support", () => {
  it("is off for the version that cannot forward one", async () => {
    expect(await withVersion("0.7.22")).toBe(false);
  });

  it("is on from the version that can", async () => {
    expect(await withVersion("0.7.23")).toBe(true);
  });

  it("stays on for later versions", async () => {
    expect(await withVersion("0.8.0")).toBe(true);
    expect(await withVersion("1.0.0")).toBe(true);
    expect(await withVersion("0.7.100")).toBe(true);
  });

  it("compares numerically, not as text", async () => {
    // "0.7.9" > "0.7.23" as strings, and a lexicographic gate would open the
    // feature on a build that cannot carry the key.
    expect(await withVersion("0.7.9")).toBe(false);
  });

  it("tolerates a range or prefix in the pin", async () => {
    expect(await withVersion("^0.7.23")).toBe(true);
    expect(await withVersion("~0.7.22")).toBe(false);
  });

  it("fails closed on a version it cannot read", async () => {
    expect(await withVersion("")).toBe(false);
    expect(await withVersion("next")).toBe(false);
  });
});

describe("versions that are not a plain release", () => {
  it("refuses a prerelease of the required version", async () => {
    // A reachable pin — Vite injects the specifier verbatim — and a loose parse
    // reads `0.7.23-beta.1` as newer than `0.7.23`. It may not carry the prop
    // at all, which would leave the store under a random key: the gate has to
    // be wrong in the other direction.
    expect(await withVersion("0.7.23-beta.1")).toBe(false);
    expect(await withVersion("0.8.0-rc.1")).toBe(false);
  });

  it("refuses a range that does not pin a release", async () => {
    expect(await withVersion(">=0.7.23 <0.8")).toBe(false);
    expect(await withVersion("workspace:*")).toBe(false);
  });
});
