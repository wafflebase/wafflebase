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
