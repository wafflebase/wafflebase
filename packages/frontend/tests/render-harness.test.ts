// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// The harness module launches a dev server and a browser only when called;
// importing it for the pure filter must not need either.
vi.mock("vite", () => ({ createServer: vi.fn() }));
vi.mock("playwright", () => ({ chromium: { launch: vi.fn() } }));

const { isLoopbackRequest } = await import("../scripts/render-harness.mjs");

describe("isLoopbackRequest", () => {
  it("lets loopback http(s) and inline data through", () => {
    for (const url of [
      "http://127.0.0.1:5173/scripts/render-slides.html",
      "https://localhost/font.woff2",
      "http://[::1]:4000/image.png",
      "data:image/png;base64,AAAA",
      "blob:http://127.0.0.1:5173/0b7c1f4e",
    ]) {
      expect(isLoopbackRequest(url), url).toBe(true);
    }
  });

  it("refuses every other host, including look-alikes", () => {
    for (const url of [
      "https://fonts.gstatic.com/s/inter.woff2",
      "http://example.com/image.png",
      // A loopback name as a subdomain or userinfo is still the other host.
      "http://127.0.0.1.attacker.example/x",
      "http://localhost.attacker.example/x",
      "http://127.0.0.1@attacker.example/x",
      // Only the literal loopback spellings the harness serves on.
      "http://127.0.0.2/x",
      "http://0.0.0.0/x",
      "http://10.0.0.1/x",
    ]) {
      expect(isLoopbackRequest(url), url).toBe(false);
    }
  });

  it("refuses non-http schemes and unparseable input", () => {
    for (const url of [
      "file:///etc/passwd",
      "ws://127.0.0.1:5173/",
      "ftp://localhost/x",
      "not a url",
      "",
    ]) {
      expect(isLoopbackRequest(url), url).toBe(false);
    }
  });
});
