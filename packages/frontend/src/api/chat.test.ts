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

describe("isUnknownClientIdRefusal", () => {
  it("matches the exact answer Nest's ValidationPipe gives", async () => {
    const { isUnknownClientIdRefusal } = await load();
    expect(
      await isUnknownClientIdRefusal(
        badRequest(["property clientId should not exist"]),
      ),
    ).toBe(true);
    // Alongside another refusal, and as a lone string.
    expect(
      await isUnknownClientIdRefusal(
        badRequest(["body should not be empty", "property clientId should not exist"]),
      ),
    ).toBe(true);
    expect(
      await isUnknownClientIdRefusal(badRequest("property clientId should not exist")),
    ).toBe(true);
  });

  it("leaves every other answer alone", async () => {
    const { isUnknownClientIdRefusal } = await load();
    const no = async (res: Response) =>
      expect(await isUnknownClientIdRefusal(res)).toBe(false);
    await no(badRequest(["property body should not exist"]));
    await no(badRequest(["clientId must be a UUID"]));
    await no(new Response("property clientId should not exist", { status: 400 }));
    await no(
      new Response(
        JSON.stringify({ message: ["property clientId should not exist"] }),
        { status: 422 },
      ),
    );
    await no(okJson({ id: "m1" }));
  });

  it("does not consume the response it reads", async () => {
    const { isUnknownClientIdRefusal } = await load();
    const res = badRequest(["body must be shorter than or equal to 4000 characters"]);
    await isUnknownClientIdRefusal(res);
    await expect(res.json()).resolves.toMatchObject({ statusCode: 400 });
  });
});

describe("fetchChannelFiles paging", () => {
  beforeEach(() => mockFetch.mockReset());

  it("asks for the first page with no paging parameters", async () => {
    const { fetchChannelFiles } = await load();
    mockFetch.mockResolvedValueOnce(okJson({ files: [], cursor: null }));
    await fetchChannelFiles("w1", "c1");
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.pathname).toMatch(/\/workspaces\/w1\/chat\/channels\/c1\/files$/);
    expect([...url.searchParams.keys()]).toEqual([]);
  });

  it("sends limit and an opaque cursor, encoded", async () => {
    const { fetchChannelFiles } = await load();
    const page = { files: [], cursor: "next" };
    mockFetch.mockResolvedValueOnce(okJson(page));
    // A cursor is opaque: whatever it holds must arrive as it was handed out.
    const before = "2026-11-25T00:00:00.000Z|a+b/c=&d";
    await expect(
      fetchChannelFiles("w1", "c1", { limit: 20, before }),
    ).resolves.toEqual(page);
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("before")).toBe(before);
    expect(url.search).not.toContain("a+b/c=&d");
  });
});

describe("fetchDocumentSharedIn", () => {
  beforeEach(() => mockFetch.mockReset());

  it("asks the document's channels route and unwraps its list", async () => {
    const { fetchDocumentSharedIn } = await load();
    const channels = [{ channelId: "c1", sharedAt: "2026-11-25T00:00:00.000Z" }];
    mockFetch.mockResolvedValueOnce(okJson({ channels }));
    await expect(fetchDocumentSharedIn("w 1", "d/1")).resolves.toEqual(channels);
    expect(mockFetch.mock.calls[0][0]).toMatch(
      /\/workspaces\/w%201\/chat\/documents\/d%2F1\/channels$/,
    );
  });

  it("fails loudly on an error answer", async () => {
    const { fetchDocumentSharedIn } = await load();
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ statusCode: 500 }), { status: 500 }),
    );
    await expect(fetchDocumentSharedIn("w1", "d1")).rejects.toMatchObject({
      status: 500,
    });
  });
});
