import { afterEach, describe, expect, it, vi } from "vitest";
import { appendShareTokenToImageUrl } from "./share-image-url";

const TOKEN = "share-tok-123";
const BACKEND = "https://api.wafflebase.io";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appendShareTokenToImageUrl", () => {
  it("appends the token to a root-relative workspace image URL", () => {
    expect(
      appendShareTokenToImageUrl(
        "/api/v1/workspaces/w1/images/abc.png",
        TOKEN,
      ),
    ).toBe("/api/v1/workspaces/w1/images/abc.png?token=share-tok-123");
  });

  it("appends the token to an absolute URL on the configured backend origin", () => {
    vi.stubEnv("VITE_BACKEND_API_URL", BACKEND);
    expect(
      appendShareTokenToImageUrl(
        `${BACKEND}/api/v1/workspaces/w1/images/abc.png`,
        TOKEN,
      ),
    ).toBe(`${BACKEND}/api/v1/workspaces/w1/images/abc.png?token=share-tok-123`);
  });

  it("does NOT append the token to a foreign origin that embeds the workspace path", () => {
    // Security: `data.src` comes from the CRDT; a malicious collaborator could
    // point it at an attacker host to exfiltrate the viewer's share token.
    vi.stubEnv("VITE_BACKEND_API_URL", BACKEND);
    const evil = "https://attacker.example/api/v1/workspaces/w1/images/abc.png";
    expect(appendShareTokenToImageUrl(evil, TOKEN)).toBe(evil);
  });

  it("does NOT append the token to any absolute URL when no backend origin is configured", () => {
    vi.stubEnv("VITE_BACKEND_API_URL", "");
    const abs = "https://api.wafflebase.io/api/v1/workspaces/w1/images/abc.png";
    expect(appendShareTokenToImageUrl(abs, TOKEN)).toBe(abs);
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
