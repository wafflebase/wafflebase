import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BRAND_FONTS_HREF,
  isBrandPath,
  loadBrandFonts,
  loadBrandFontsForPath,
} from "./brand-fonts";

function fontLinks() {
  return [...document.head.querySelectorAll<HTMLLinkElement>("link")].filter(
    (link) => link.href.includes("fonts.g"),
  );
}

afterEach(() => {
  for (const link of fontLinks()) link.remove();
});

describe("brand fonts", () => {
  it("are not requested by index.html, so no route waits on them", () => {
    const html = readFileSync(
      path.resolve(__dirname, "../../index.html"),
      "utf8",
    );
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
  });

  it("classifies only the marketing surfaces as brand routes", () => {
    for (const p of ["/", "/login", "/templates", "/t/abc"]) {
      expect(isBrandPath(p)).toBe(true);
    }
    for (const p of ["/w/acme", "/w/acme/templates", "/d/1", "/s/token", "/tx"]) {
      expect(isBrandPath(p)).toBe(false);
    }
  });

  it("injects preconnects and the stylesheet once", () => {
    loadBrandFonts();
    loadBrandFonts();

    const sheets = fontLinks().filter((l) => l.rel === "stylesheet");
    expect(sheets).toHaveLength(1);
    expect(sheets[0].href).toBe(BRAND_FONTS_HREF);
    expect(BRAND_FONTS_HREF).toContain("display=swap");

    const preconnects = fontLinks().filter((l) => l.rel === "preconnect");
    expect(preconnects.map((l) => l.href)).toEqual([
      "https://fonts.googleapis.com/",
      "https://fonts.gstatic.com/",
    ]);
    // The font files are fetched in CORS mode, so the gstatic connection
    // must be anonymous-CORS or the preconnect is wasted.
    expect(preconnects[1].crossOrigin).toBe("");
  });

  it("leaves app routes without any font request", () => {
    loadBrandFontsForPath("/w/acme/d/123");
    expect(fontLinks()).toHaveLength(0);

    loadBrandFontsForPath("/login");
    expect(fontLinks().filter((l) => l.rel === "stylesheet")).toHaveLength(1);
  });
});
