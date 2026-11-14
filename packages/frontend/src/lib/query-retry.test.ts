import { describe, expect, it } from "vitest";
import { HttpError } from "@/api/http-error";
import { AuthExpiredError } from "@/api/auth";
import { shouldRetryQuery } from "./query-retry";

describe("shouldRetryQuery", () => {
  it("does not retry a request the server refused on its merits", () => {
    for (const status of [400, 401, 403, 404, 409, 410, 422]) {
      expect(shouldRetryQuery(0, new HttpError("no", status))).toBe(false);
    }
  });

  it("does not retry an expired session", () => {
    expect(shouldRetryQuery(0, new AuthExpiredError())).toBe(false);
  });

  it("retries timeouts, rate limits and server errors up to three times", () => {
    for (const status of [408, 429, 500, 502, 503]) {
      const error = new HttpError("busy", status);
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(2, error)).toBe(true);
      expect(shouldRetryQuery(3, error)).toBe(false);
    }
  });

  it("retries a network failure that never got a status", () => {
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(3, new TypeError("Failed to fetch"))).toBe(false);
  });
});
