import { describe, expect, it } from "vitest";
import { redactCapabilityTokens, redactUrlsInText } from "./redact-url";

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

describe("redactUrlsInText", () => {
  it("redacts a URL embedded in a sentence", () => {
    expect(
      redactUrlsInText("could not load /documents/x/file?token=secret twice"),
    ).toBe("could not load /documents/x/file?token=__redacted__ twice");
  });

  it("redacts an absolute URL in prose", () => {
    expect(
      redactUrlsInText("GET https://wafflebase.io/shared/abc failed"),
    ).toBe("GET https://wafflebase.io/shared/__redacted__ failed");
  });

  it("redacts more than one span", () => {
    expect(redactUrlsInText("/shared/a -> /invite/b")).toBe(
      "/shared/__redacted__ -> /invite/__redacted__",
    );
  });

  it("stops a span at a closing bracket or quote", () => {
    expect(redactUrlsInText('src="/shared/abc" (bad)')).toBe(
      'src="/shared/__redacted__" (bad)',
    );
  });

  it("leaves text with nothing to redact byte-for-byte identical", () => {
    // Important: a span is substituted only when something was actually
    // redacted, so an ordinary path is not rewritten by URL normalization.
    const text = "navigated to /w/jiyu/documents?folderId=4 ok";
    expect(redactUrlsInText(text)).toBe(text);
  });

  it("leaves text with no slash at all alone", () => {
    expect(redactUrlsInText("something went wrong")).toBe(
      "something went wrong",
    );
  });

  it("passes an empty string straight through", () => {
    expect(redactUrlsInText("")).toBe("");
  });

  it("still redacts a token in very long text", () => {
    // There is no length cap: one that returned long text verbatim failed
    // open, and a megabyte of accidentally-stringified state is exactly where
    // a token hides.
    const long = `${"x".repeat(9000)} /shared/abc`;
    expect(redactUrlsInText(long)).toBe(
      `${"x".repeat(9000)} /shared/__redacted__`,
    );
  });

  it("redacts a URL whose slashes are backslash-escaped", () => {
    // What a serializer that escapes forward slashes writes (PHP's
    // `json_encode` by default). Treating `\` as the end of a span cut this
    // into `\/shared` and `\/secret-token`, and nothing was redacted.
    expect(redactUrlsInText("open failed: \\/shared\\/secret-token")).toBe(
      "open failed: \\/shared\\/__redacted__",
    );
  });

  it("does not spend the span budget on ordinary slashes", () => {
    // Dates, fractions and source paths are all `/`-bearing spans. They used
    // to consume the budget, so a line with enough of them ahead of the URL
    // reached it with nothing left.
    const noise = Array.from({ length: 400 }, (_, i) => `2026/11/${i}`).join(
      " ",
    );
    expect(redactUrlsInText(`${noise} /shared/abc`)).toBe(
      `${noise} /shared/__redacted__`,
    );
  });

  it("replaces a span in full once the budget is exhausted", () => {
    // Fails closed: past the bound a capability-shaped span is dropped rather
    // than passed through.
    const many = Array.from({ length: 300 }, () => "/shared/abc").join(" ");
    const out = redactUrlsInText(many);
    expect(out).not.toContain("abc");
    expect(out).toContain("__redacted__");
  });

  it("keeps the host of a protocol-relative URL", () => {
    expect(redactUrlsInText("fetch //cdn.example/shared/abc failed")).toBe(
      "fetch //cdn.example/shared/__redacted__ failed",
    );
  });
});
