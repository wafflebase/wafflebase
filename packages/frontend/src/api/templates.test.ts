import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth", () => ({ fetchWithAuth: vi.fn() }));

import { fetchWithAuth } from "./auth";
import { getDocumentTemplate } from "./templates";

const mockFetch = vi.mocked(fetchWithAuth);

function okText(body: string) {
  return new Response(body, { status: 200 });
}

describe("getDocumentTemplate", () => {
  beforeEach(() => mockFetch.mockReset());

  it("returns null for the empty 200 an unpublished document answers", async () => {
    mockFetch.mockResolvedValue(okText(""));
    await expect(getDocumentTemplate("doc-1")).resolves.toBeNull();
  });

  it("returns null for an explicit JSON null", async () => {
    mockFetch.mockResolvedValue(okText("null"));
    await expect(getDocumentTemplate("doc-1")).resolves.toBeNull();
  });

  it("parses the listing when one exists", async () => {
    mockFetch.mockResolvedValue(okText(JSON.stringify({ id: "tpl-1" })));
    await expect(getDocumentTemplate("doc-1")).resolves.toEqual({
      id: "tpl-1",
    });
    expect(String(mockFetch.mock.calls[0][0])).toMatch(
      /\/documents\/doc-1\/template$/,
    );
  });
});
