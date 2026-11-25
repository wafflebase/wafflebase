import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Event } from "@sentry/react";
import { scrubCapabilityTokens } from "./sentry";

/**
 * The hook, not the helper. `redact-url.test.ts` already covers the string
 * rewriting; what has to be right here is WHICH fields are reached — every one
 * of these carries a capability token out of the browser, and each was a
 * separate way to miss it.
 */
describe("scrubCapabilityTokens", () => {
  it("redacts the request URL", () => {
    const event = {
      request: { url: "https://wafflebase.io/shared/secret-token" },
    } as Event;

    expect(scrubCapabilityTokens(event).request?.url).toBe(
      "https://wafflebase.io/shared/__redacted__",
    );
  });

  it("redacts the Referer header", () => {
    // Filled from `document.referrer`, so navigating away from a share link
    // carries the token into the NEXT page's events.
    const event = {
      request: {
        url: "https://wafflebase.io/documents",
        headers: { Referer: "https://wafflebase.io/shared/secret-token" },
      },
    } as unknown as Event;

    expect(scrubCapabilityTokens(event).request?.headers?.Referer).toBe(
      "https://wafflebase.io/shared/__redacted__",
    );
  });

  it("redacts a lower-cased referer header too", () => {
    const event = {
      request: {
        headers: { referer: "/invite/secret-token" },
      },
    } as unknown as Event;

    expect(scrubCapabilityTokens(event).request?.headers?.referer).toBe(
      "/invite/__redacted__",
    );
  });

  it("redacts the transaction name", () => {
    const event = { transaction: "/shared/secret-token" } as Event;

    expect(scrubCapabilityTokens(event).transaction).toBe(
      "/shared/__redacted__",
    );
  });

  it("redacts navigation and fetch breadcrumbs", () => {
    const event = {
      breadcrumbs: [
        { category: "navigation", data: { from: "/shared/aaa", to: "/w/x" } },
        { category: "fetch", data: { url: "/api/v1/x?token=bbb" } },
      ],
    } as unknown as Event;

    const scrubbed = scrubCapabilityTokens(event);
    expect(scrubbed.breadcrumbs?.[0].data?.from).toBe("/shared/__redacted__");
    expect(scrubbed.breadcrumbs?.[0].data?.to).toBe("/w/x");
    expect(scrubbed.breadcrumbs?.[1].data?.url).toBe(
      "/api/v1/x?token=__redacted__",
    );
  });

  it("redacts a token inside a ui.click breadcrumb message", () => {
    // The SDK serializes the clicked element, aria-label and title included.
    const event = {
      breadcrumbs: [
        {
          category: "ui.click",
          message:
            'div.card > svg[aria-label="QR for https://wafflebase.io/shared/aaa"] > p[title="/invite/bbb?x=1"]',
        },
      ],
    } as unknown as Event;

    expect(scrubCapabilityTokens(event).breadcrumbs?.[0].message).toBe(
      'div.card > svg[aria-label="QR for https://wafflebase.io/shared/__redacted__"] > p[title="/invite/__redacted__?x=1"]',
    );
  });

  it("redacts a path that starts the breadcrumb message", () => {
    // The root-relative alternative is written with a captured preceding
    // character instead of a lookbehind (Safari 16.0 is in Vite's default
    // target), so the start-of-string case needs its own cover.
    const event = {
      breadcrumbs: [{ category: "ui.click", message: "/shared/aaa clicked" }],
    } as unknown as Event;

    expect(scrubCapabilityTokens(event).breadcrumbs?.[0].message).toBe(
      "/shared/__redacted__ clicked",
    );
  });

  it("redacts child spans of a transaction", () => {
    // Share-scoped images and file downloads put the raw token in `?token=`,
    // and each load becomes a span whose description and attributes repeat the
    // whole URL. `event.transaction` does not cover these.
    const event = {
      type: "transaction",
      spans: [
        {
          op: "http.client",
          description: "GET /api/v1/x?token=aaa",
          data: {
            "http.url": "https://wafflebase.io/images/y?token=aaa",
            "http.query": "?token=aaa",
            "http.response_status_code": 200,
          },
        },
        {
          op: "resource.img",
          description: "https://wafflebase.io/shared/bbb/thumb.png",
          data: { "url.full": "/shared/bbb/thumb.png", "url.query": "" },
        },
      ],
    } as unknown as Event;

    const scrubbed = scrubCapabilityTokens(event);
    expect(scrubbed.spans?.[0].description).toBe(
      "GET /api/v1/x?token=__redacted__",
    );
    expect(scrubbed.spans?.[0].data["http.url"]).toBe(
      "https://wafflebase.io/images/y?token=__redacted__",
    );
    expect(scrubbed.spans?.[0].data["http.query"]).toBe("?token=__redacted__");
    expect(scrubbed.spans?.[0].data["http.response_status_code"]).toBe(200);
    expect(scrubbed.spans?.[1].description).toBe(
      "https://wafflebase.io/shared/__redacted__/thumb.png",
    );
    expect(scrubbed.spans?.[1].data["url.full"]).toBe(
      "/shared/__redacted__/thumb.png",
    );
    expect(scrubbed.spans?.[1].data["url.query"]).toBe("");
  });

  it("survives a span with no data or description", () => {
    const event = {
      type: "transaction",
      spans: [{ op: "ui.render" }],
    } as unknown as Event;

    expect(() => scrubCapabilityTokens(event)).not.toThrow();
  });

  it("scrubs a transaction event the same way", () => {
    // The gap that mattered most: `beforeSend` never sees these, and
    // `browserTracingIntegration` emits one per pageload and navigation.
    const event = {
      type: "transaction",
      transaction: "/shared/secret-token",
      request: { url: "https://wafflebase.io/shared/secret-token" },
    } as unknown as Event;

    const scrubbed = scrubCapabilityTokens(event);
    expect(scrubbed.transaction).toBe("/shared/__redacted__");
    expect(scrubbed.request?.url).toBe(
      "https://wafflebase.io/shared/__redacted__",
    );
  });

  it("leaves an event with nothing to redact untouched", () => {
    const event = {
      transaction: "/w/jiyu",
      request: { url: "https://wafflebase.io/w/jiyu" },
    } as Event;

    const scrubbed = scrubCapabilityTokens(event);
    expect(scrubbed.transaction).toBe("/w/jiyu");
    expect(scrubbed.request?.url).toBe("https://wafflebase.io/w/jiyu");
  });

  it("survives an event with no request, transaction or breadcrumbs", () => {
    expect(() => scrubCapabilityTokens({} as Event)).not.toThrow();
  });

  it("returns the same event object, as the hook contract requires", () => {
    const event = { transaction: "/shared/x" } as Event;
    expect(scrubCapabilityTokens(event)).toBe(event);
  });
});

describe("sentry.ts build baseline", () => {
  it("uses no RegExp lookbehind", () => {
    // Not style, and not something a behavioral test can see: `vite.config.ts`
    // pins no `build.target`, so Vite's default `baseline-widely-available`
    // target includes Safari 16.0. Lookbehind landed in 16.4 and esbuild
    // cannot transform regexp syntax, so such a literal ships verbatim — and a
    // regex literal that does not parse is a SyntaxError at MODULE level.
    // `main.tsx` imports this file before it renders anything, so the cost is
    // a blank app on those browsers, not a missed redaction. Read the source
    // rather than the pattern: the hazard is the literal existing at all.
    const source = readFileSync(
      path.resolve(__dirname, "./sentry.ts"),
      "utf8",
    );

    // Skip the prose that explains the ban, which names the construct.
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/\(\?<[=!]/);
  });
});
