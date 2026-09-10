import { describe, it, expect } from "vitest";
import { isRevokedShareLinkError } from "@/api/share-links";
import { HttpError } from "@/api/http-error";

/**
 * `SharedDocumentByToken` re-resolves its token on an interval, so it now has
 * to tell two kinds of failure apart. `useQuery` keeps its last good `data`
 * while reporting `error` for every background refetch failure, so treating
 * any error as fatal tore a live editing session down on the first outage
 * that outlasted the retry — losing whatever had not synced.
 */
describe("isRevokedShareLinkError", () => {
  it("treats the server's verdict on the link as fatal", () => {
    // 404 revoked / never existed, 410 expired, 403 no longer permitted.
    for (const status of [400, 401, 403, 404, 410]) {
      expect(isRevokedShareLinkError(new HttpError("gone", status))).toBe(true);
    }
  });

  it("does not evict a live session for a request that got no answer", () => {
    // The `TypeError` `fetch()` throws when it cannot connect.
    expect(isRevokedShareLinkError(new TypeError("Failed to fetch"))).toBe(
      false,
    );
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isRevokedShareLinkError(new HttpError("nope", status))).toBe(
        false,
      );
    }
  });

  it("is false for a non-error value", () => {
    expect(isRevokedShareLinkError(undefined)).toBe(false);
    expect(isRevokedShareLinkError(null)).toBe(false);
    expect(isRevokedShareLinkError("404")).toBe(false);
  });
});
