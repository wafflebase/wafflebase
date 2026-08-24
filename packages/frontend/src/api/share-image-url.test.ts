import { describe, expect, it } from "vitest";
import { appendShareTokenToImageUrl } from "./share-image-url";

const TOKEN = "share-tok-123";

describe("appendShareTokenToImageUrl", () => {
  it("appends the token to a root-relative workspace image URL", () => {
    expect(
      appendShareTokenToImageUrl(
        "/api/v1/workspaces/w1/images/abc.png",
        TOKEN,
      ),
    ).toBe("/api/v1/workspaces/w1/images/abc.png?token=share-tok-123");
  });

  it("appends the token to an absolute workspace image URL", () => {
    expect(
      appendShareTokenToImageUrl(
        "https://api.wafflebase.io/api/v1/workspaces/w1/images/abc.png",
        TOKEN,
      ),
    ).toBe(
      "https://api.wafflebase.io/api/v1/workspaces/w1/images/abc.png?token=share-tok-123",
    );
  });

  it("uses & when the URL already has a query string", () => {
    expect(
      appendShareTokenToImageUrl(
        "/api/v1/workspaces/w1/images/abc.png?v=2",
        TOKEN,
      ),
    ).toBe("/api/v1/workspaces/w1/images/abc.png?v=2&token=share-tok-123");
  });

  it("is idempotent — never double-appends a token", () => {
    const once = appendShareTokenToImageUrl(
      "/api/v1/workspaces/w1/images/abc.png",
      TOKEN,
    );
    expect(appendShareTokenToImageUrl(once, TOKEN)).toBe(once);
  });

  it("preserves a trailing hash", () => {
    expect(
      appendShareTokenToImageUrl(
        "/api/v1/workspaces/w1/images/abc.png#frag",
        TOKEN,
      ),
    ).toBe("/api/v1/workspaces/w1/images/abc.png?token=share-tok-123#frag");
  });

  it("leaves data: URLs untouched", () => {
    const data = "data:image/png;base64,iVBORw0KGgo=";
    expect(appendShareTokenToImageUrl(data, TOKEN)).toBe(data);
  });

  it("leaves external / non-workspace URLs untouched", () => {
    const ext = "https://cdn.example.com/pic.png";
    expect(appendShareTokenToImageUrl(ext, TOKEN)).toBe(ext);
  });

  it("returns the src unchanged when the token is empty", () => {
    const url = "/api/v1/workspaces/w1/images/abc.png";
    expect(appendShareTokenToImageUrl(url, "")).toBe(url);
  });

  it("url-encodes a token with special characters", () => {
    expect(
      appendShareTokenToImageUrl("/api/v1/workspaces/w1/images/abc.png", "a/b c"),
    ).toBe("/api/v1/workspaces/w1/images/abc.png?token=a%2Fb%20c");
  });
});
