import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newClientId } from "@/components/chat/send-failure";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// The server's `clientId` rule; an id outside it fails every send with a 400.
const SERVER_RULE = /^[A-Za-z0-9_-]{1,64}$/;

describe("newClientId outside a secure context", () => {
  // Plain http has `getRandomValues` but no `randomUUID`.
  const original = crypto.randomUUID;
  beforeEach(() => {
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(crypto, "randomUUID", {
      value: original,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("masks the version and variant into the random bytes", () => {
    // All bits set, so a missing mask would show.
    vi.spyOn(crypto, "getRandomValues").mockImplementation(
      <T extends ArrayBufferView | null>(array: T): T => {
        new Uint8Array(array!.buffer).fill(0xff);
        return array;
      },
    );
    const id = newClientId();
    expect(id).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(id).toMatch(SERVER_RULE);
  });

  it("builds a fresh v4 UUID on every call", () => {
    const a = newClientId();
    const b = newClientId();
    expect(a).toMatch(V4);
    expect(b).toMatch(V4);
    expect(a).toMatch(SERVER_RULE);
    expect(a).not.toBe(b);
  });
});
