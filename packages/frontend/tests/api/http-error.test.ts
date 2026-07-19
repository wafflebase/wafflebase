import { test, expect, describe, it } from 'vitest';
import {
  HttpError,
  assertOk,
  parseRetryAfterMs,
  readResponseErrorMessage,
} from "../../src/api/http-error.ts";

test("readResponseErrorMessage reads JSON message string", async () => {
  const response = new Response(JSON.stringify({ message: "Bad request" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });

  const message = await readResponseErrorMessage(response);
  expect(message).toBe("Bad request");
});

test("readResponseErrorMessage joins JSON message arrays", async () => {
  const response = new Response(
    JSON.stringify({ message: ["a", "b", "  ", null] }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    },
  );

  const message = await readResponseErrorMessage(response);
  expect(message).toBe("a, b");
});

test("readResponseErrorMessage falls back to trimmed text body", async () => {
  const response = new Response("  plain failure  ", { status: 500 });
  const message = await readResponseErrorMessage(response);
  expect(message).toBe("plain failure");
});

test("assertOk uses status override before response body", async () => {
  const response = new Response(JSON.stringify({ message: "ignored" }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  });

  await expect(assertOk(response, "fallback", {
    statusMessages: { 410: "expired" },
  })).rejects.toThrow(/expired/);
});

test("assertOk uses body message then fallback", async () => {
  const withMessage = new Response(JSON.stringify({ error: "detail" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
  await expect(assertOk(withMessage, "fallback")).rejects.toThrow(/detail/);

  const emptyBody = new Response("", { status: 400 });
  await expect(assertOk(emptyBody, "fallback")).rejects.toThrow(/fallback/);
});

test("assertOk does not throw for OK responses", async () => {
  const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
  await expect(assertOk(response, "fallback")).resolves.not.toThrow();
});

function res(retryAfter?: string): Response {
  const headers = new Headers();
  if (retryAfter !== undefined) headers.set("retry-after", retryAfter);
  return new Response(null, { status: 429, headers });
}

describe("parseRetryAfterMs", () => {
  it("returns undefined when the header is absent", () => {
    expect(parseRetryAfterMs(res())).toBeUndefined();
  });
  it("parses delta-seconds to milliseconds", () => {
    expect(parseRetryAfterMs(res("5"))).toBe(5000);
  });
  it("clamps a negative delta to 0", () => {
    expect(parseRetryAfterMs(res("-3"))).toBe(0);
  });
  it("parses an HTTP-date to a non-negative delay", () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfterMs(res(future));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(10_000);
  });
  it("returns undefined for a garbage value", () => {
    expect(parseRetryAfterMs(res("not-a-date"))).toBeUndefined();
  });
});

describe("HttpError", () => {
  it("is an Error carrying status and retryAfterMs", () => {
    const err = new HttpError("boom", 429, 1234);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(1234);
  });
});
