import { describe, expect, it } from "vitest";
import { redactCapabilityTokens } from "./redact-url";

describe("redactCapabilityTokens", () => {
  it.each([
    [
      "a share link",
      "https://wafflebase.io/shared/3f8a9c2b1d",
      "https://wafflebase.io/shared/__redacted__",
    ],
    [
      "an invite link",
      "https://wafflebase.io/invite/abc123",
      "https://wafflebase.io/invite/__redacted__",
    ],
    [
      "a template listing id",
      "https://wafflebase.io/t/9d1e",
      "https://wafflebase.io/t/__redacted__",
    ],
    [
      "a token query parameter",
      "https://wafflebase.io/f/42?token=secret",
      "https://wafflebase.io/f/42?token=__redacted__",
    ],
  ])("redacts %s", (_name, input, expected) => {
    expect(redactCapabilityTokens(input)).toBe(expected);
  });

  it("leaves an ordinary workspace URL alone", () => {
    // The URL from Sentry WAFFLEBASE-2. A workspace id is not a capability,
    // and over-redacting would cost the one field that says where the failure
    // happened.
    const url = "https://wafflebase.io/w/jiyu";
    expect(redactCapabilityTokens(url)).toBe(url);
  });

  it("redacts a relative URL without inventing an origin", () => {
    // Sentry navigation breadcrumbs carry paths, not absolute URLs.
    expect(redactCapabilityTokens("/shared/3f8a9c2b1d")).toBe(
      "/shared/__redacted__",
    );
  });

  it("keeps the query and hash of a relative URL", () => {
    expect(redactCapabilityTokens("/shared/tok?tab=2#cell")).toBe(
      "/shared/__redacted__?tab=2#cell",
    );
  });

  it("does not redact a bare /shared with no token after it", () => {
    expect(redactCapabilityTokens("/shared")).toBe("/shared");
    expect(redactCapabilityTokens("/shared/")).toBe("/shared/");
  });

  it("redacts every capability segment in one URL", () => {
    expect(redactCapabilityTokens("/shared/aaa?token=bbb")).toBe(
      "/shared/__redacted__?token=__redacted__",
    );
  });

  it("leaves an unparseable value unchanged rather than dropping it", () => {
    // A malformed URL is not evidence of a token, and an empty field costs
    // more debugging than it buys.
    expect(redactCapabilityTokens("http://[::bad")).toBe("http://[::bad");
  });

  it("passes an empty string straight through", () => {
    expect(redactCapabilityTokens("")).toBe("");
  });

  it("does not treat a path that merely contains the word shared as one", () => {
    const url = "/documents/shared-notes";
    expect(redactCapabilityTokens(url)).toBe(url);
  });
});
