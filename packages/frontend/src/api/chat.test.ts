import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth", () => ({ fetchWithAuth: vi.fn() }));

import { fetchWithAuth } from "./auth";

const mockFetch = vi.mocked(fetchWithAuth);

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function badRequest(message: string[] | string) {
  return new Response(
    JSON.stringify({ statusCode: 400, message, error: "Bad Request" }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

const sentBody = (call: number) =>
  JSON.parse(mockFetch.mock.calls[call][1]!.body as string);

// The "server takes clientId" flag is module state, so each case starts from
// a fresh copy of the module.
async function load() {
  vi.resetModules();
  return import("./chat");
}

describe("postMessage against a backend that predates clientId", () => {
  beforeEach(() => mockFetch.mockReset());

  it("resends without clientId and remembers to skip it after", async () => {
    const { postMessage } = await load();
    mockFetch
      .mockResolvedValueOnce(badRequest(["property clientId should not exist"]))
      .mockResolvedValueOnce(okJson({ id: "m1" }))
      .mockResolvedValueOnce(okJson({ id: "m2" }));

    await expect(
      postMessage("w1", "c1", { body: "hi", clientId: "a" }),
    ).resolves.toEqual({ id: "m1" });
    expect(sentBody(0)).toEqual({ body: "hi", clientId: "a" });
    expect(sentBody(1)).toEqual({ body: "hi" });

    await postMessage("w1", "c1", { body: "again", clientId: "b" });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(sentBody(2)).toEqual({ body: "again" });
  });

  it("keeps sending clientId to a backend that accepts it", async () => {
    const { postMessage } = await load();
    mockFetch.mockImplementation(async () => okJson({ id: "m1" }));
    await postMessage("w1", "c1", { body: "hi", clientId: "a" });
    await postMessage("w1", "c1", { body: "hi", clientId: "b" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(sentBody(1)).toEqual({ body: "hi", clientId: "b" });
  });

  it("leaves a 400 for another reason final", async () => {
    const { postMessage } = await load();
    mockFetch.mockResolvedValueOnce(
      badRequest(["body must be shorter than or equal to 4000 characters"]),
    );
    const err = await postMessage("w1", "c1", {
      body: "x",
      clientId: "a",
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "HttpError", status: 400 });
    expect((err as Error).message).toMatch(/4000 characters/);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // And clientId is still sent next time.
    mockFetch.mockResolvedValueOnce(okJson({ id: "m1" }));
    await postMessage("w1", "c1", { body: "y", clientId: "b" });
    expect(sentBody(1)).toEqual({ body: "y", clientId: "b" });
  });
});

describe("fetchChannelFiles against a backend without Files", () => {
  beforeEach(() => mockFetch.mockReset());

  it("answers an empty list for a 404", async () => {
    const { fetchChannelFiles } = await load();
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ statusCode: 404 }), { status: 404 }),
    );
    await expect(fetchChannelFiles("w1", "c1")).resolves.toEqual({
      files: [],
      cursor: null,
    });
  });
});
