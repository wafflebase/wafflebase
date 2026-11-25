import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anchorLabel,
  buildDocumentPath,
  buildDocumentUrl,
  decodeAnchor,
  encodeAnchor,
  parseDocumentLink,
  routerBasename,
} from "@/components/chat/document-link";

const ID = "0b6f3c2e-8a4d-4f1e-9c7b-2d5e6f708192";
const ORIGIN = "https://app.test";

describe("parseDocumentLink", () => {
  it("reads an absolute same-origin link and its query", () => {
    expect(
      parseDocumentLink(`${ORIGIN}/s/${ID}?chat=c1&at=abc`, ORIGIN, ""),
    ).toEqual({ documentId: ID, route: "s", chat: "c1", at: "abc" });
  });

  it("reads a root-relative path, for every editor route", () => {
    for (const r of ["s", "d", "p", "n", "b", "f"]) {
      expect(parseDocumentLink(`/${r}/${ID}`, ORIGIN, "")?.route).toBe(r);
    }
  });

  it("refuses another origin, other routes, and non-uuid ids", () => {
    expect(parseDocumentLink(`https://evil.test/s/${ID}`, ORIGIN, "")).toBeNull();
    expect(parseDocumentLink(`//evil.test/s/${ID}`, ORIGIN, "")).toBeNull();
    expect(parseDocumentLink(`${ORIGIN}/w/${ID}`, ORIGIN, "")).toBeNull();
    expect(parseDocumentLink(`${ORIGIN}/s/abc`, ORIGIN, "")).toBeNull();
    expect(parseDocumentLink(`${ORIGIN}/s/${ID}/edit`, ORIGIN, "")).toBeNull();
    expect(parseDocumentLink("not a url", ORIGIN, "")).toBeNull();
  });

  it("strips the basename and lowercases the id", () => {
    expect(
      parseDocumentLink(`${ORIGIN}/app/d/${ID.toUpperCase()}`, ORIGIN, "/app")
        ?.documentId,
    ).toBe(ID);
  });
});

describe("the router basename default", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is empty when unset", () => {
    vi.stubEnv("VITE_FRONTEND_BASENAME", "");
    expect(routerBasename()).toBe("");
  });

  it("reads VITE_FRONTEND_BASENAME without its trailing slash", () => {
    vi.stubEnv("VITE_FRONTEND_BASENAME", "/app/");
    expect(routerBasename()).toBe("/app");
  });

  it("is what parseDocumentLink strips and buildDocumentUrl adds", () => {
    vi.stubEnv("VITE_FRONTEND_BASENAME", "/app");
    const url = buildDocumentUrl({ id: ID, type: "doc" }, {}, ORIGIN);
    expect(url).toBe(`${ORIGIN}/app/d/${ID}`);
    expect(parseDocumentLink(url, ORIGIN)?.documentId).toBe(ID);
    // Off the basename is not this app's document route.
    expect(parseDocumentLink(`${ORIGIN}/other/d/${ID}`, ORIGIN)).toBeNull();
  });
});

describe("buildDocumentPath / buildDocumentUrl", () => {
  it("routes by type and adds chat and at", () => {
    expect(buildDocumentPath({ id: ID, type: "slides" })).toBe(`/p/${ID}`);
    expect(buildDocumentPath({ id: ID, type: "image" })).toBe(`/f/${ID}`);
    const anchor = { slideId: "s1" };
    const path = buildDocumentPath(
      { id: ID, type: "slides" },
      { chat: "c1", at: anchor },
    );
    expect(path).toBe(`/p/${ID}?chat=c1&at=${encodeAnchor(anchor)}`);
    expect(buildDocumentPath({ id: ID, type: "sheet" }, { at: "raw" })).toBe(
      `/s/${ID}?at=raw`,
    );
  });

  it("round-trips through parseDocumentLink", () => {
    const anchor = { blockId: "b1", excerpt: "한국어 text" };
    const url = buildDocumentUrl({ id: ID, type: "doc" }, { at: anchor }, ORIGIN);
    const link = parseDocumentLink(url, ORIGIN, "");
    expect(decodeAnchor(link?.at, "doc")).toEqual(anchor);
  });
});

describe("encodeAnchor / decodeAnchor", () => {
  const sheet = { tabId: "t", rowId: "r", colId: "c", rowSpan: 2, colSpan: 3 };

  it("is unpadded base64url", () => {
    expect(encodeAnchor({ ...sheet, label: "Sheet1!C3:E7?" })).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );
  });

  it("keeps only the type's own fields", () => {
    const raw = encodeAnchor({ ...sheet, extra: 1 } as never);
    expect(decodeAnchor(raw, "sheet")).toEqual(sheet);
  });

  it("rejects garbage and the wrong shape", () => {
    expect(decodeAnchor(null, "sheet")).toBeNull();
    expect(decodeAnchor("%%%", "sheet")).toBeNull();
    expect(decodeAnchor("bm90IGpzb24", "sheet")).toBeNull();
    expect(decodeAnchor(encodeAnchor(sheet), "slides")).toBeNull();
    expect(decodeAnchor(encodeAnchor({ ...sheet, rowSpan: 0 }), "sheet")).toBeNull();
    expect(
      decodeAnchor(encodeAnchor({ slideId: "s", label: "x".repeat(81) }), "slides"),
    ).toBeNull();
    expect(decodeAnchor(encodeAnchor(sheet), "note")).toBeNull();
  });
});

describe("anchorLabel", () => {
  it("prefers the label, then a doc excerpt", () => {
    expect(anchorLabel(null)).toBeNull();
    expect(anchorLabel({ slideId: "s" })).toBeNull();
    expect(anchorLabel({ slideId: "s", label: "Slide 3" })).toBe("Slide 3");
    expect(anchorLabel({ blockId: "b", excerpt: "hello" })).toBe("hello");
  });
});
