import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth", () => ({ fetchWithAuth: vi.fn() }));

import { fetchWithAuth } from "./auth";
import {
  createBot,
  createPairingCode,
  deleteBot,
  fetchBots,
} from "./bots";

const mockFetch = vi.mocked(fetchWithAuth);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("bots api", () => {
  beforeEach(() => mockFetch.mockReset());

  it("lists a workspace's bots", async () => {
    mockFetch.mockResolvedValue(json([{ id: 7, username: "helper" }]));
    await expect(fetchBots("ws-1")).resolves.toEqual([
      { id: 7, username: "helper" },
    ]);
    expect(String(mockFetch.mock.calls[0][0])).toMatch(
      /\/workspaces\/ws-1\/bots$/,
    );
  });

  it("creates a bot by name", async () => {
    mockFetch.mockResolvedValue(json({ id: 7, username: "helper" }, 201));
    await createBot("ws-1", "helper");
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/workspaces\/ws-1\/bots$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "helper" });
  });

  it("surfaces the server's message when a name is refused", async () => {
    mockFetch.mockResolvedValue(
      json({ message: "A bot named helper already exists" }, 409),
    );
    await expect(createBot("ws-1", "helper")).rejects.toThrow(
      "A bot named helper already exists",
    );
  });

  it("deletes a bot", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteBot("ws-1", 7);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/workspaces\/ws-1\/bots\/7$/);
    expect(init?.method).toBe("DELETE");
  });

  it("asks for a pairing code", async () => {
    mockFetch.mockResolvedValue(
      json({ code: "ABCD-EFGH", expiresAt: "2026-11-28T00:10:00.000Z" }),
    );
    await expect(createPairingCode("ws-1", 7)).resolves.toEqual({
      code: "ABCD-EFGH",
      expiresAt: "2026-11-28T00:10:00.000Z",
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/workspaces\/ws-1\/bots\/7\/pairing-codes$/);
    expect(init?.method).toBe("POST");
  });
});
