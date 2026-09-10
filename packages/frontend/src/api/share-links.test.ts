import { describe, it, expect } from "vitest";
import {
  isRevokedShareLinkError,
  isShareLinkResolveFatal,
  shouldRetryShareLinkResolve,
  type ResolvedShareLink,
} from "@/api/share-links";
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
    // The only two the resolve handler produces: 404 revoked or never
    // existed, 410 expired (`ShareLinkService.findByToken`).
    for (const status of [404, 410]) {
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

  it("does not evict a live session for a 4xx the handler never returns", () => {
    // These come from something in front of the handler — an auth proxy, a
    // WAF, a CDN, a redeploy answering the wrong route — and say nothing
    // about the link. Treating them as a verdict tore down a live editing
    // session AND stopped the retry, which is the failure this predicate
    // exists to avoid.
    for (const status of [400, 401, 403, 405, 413, 431, 451]) {
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

/**
 * The predicate above is only half of the safety property. What actually
 * decides whether a live editing session survives is how
 * `SharedDocumentByToken` *composes* it with the last good `resolved`, and
 * with `useQuery`'s retry budget. Those two expressions are the whole of the
 * `useState`/`useEffect` → 60-second-refetch rewrite's risk surface, so they
 * are covered here directly rather than through a mounted component.
 */
const resolvedLink: ResolvedShareLink = {
  documentId: "doc-1",
  role: "editor",
  title: "Q3 plan",
  type: "doc",
};

// The two failures the resolve handler produces, and the two it never does.
const verdict = new HttpError("gone", 404);
const expired = new HttpError("gone", 410);
const offline = new TypeError("Failed to fetch");
const restarting = new HttpError("bad gateway", 502);

describe("isShareLinkResolveFatal", () => {
  it("keeps a live session through a refetch failure with no verdict", () => {
    // The reachable case: an editor link is open with unsynced edits and the
    // lid closes for three minutes. Two interval refetches fail, so `error`
    // is set while `resolved` still holds the last good link. Evicting here
    // would discard the edits — this is what the `!resolved` conjunct and
    // the verdict predicate exist to prevent together.
    for (const err of [offline, restarting]) {
      expect(isShareLinkResolveFatal(err, resolvedLink)).toBe(false);
    }
  });

  it("closes a live session when the server gives its verdict", () => {
    for (const err of [verdict, expired]) {
      expect(isShareLinkResolveFatal(err, resolvedLink)).toBe(true);
    }
  });

  it("closes a link that never resolved, whatever the failure was", () => {
    // The discriminating case for the `!resolved` conjunct: with it dropped,
    // `fatal` would be `isRevokedShareLinkError(error)` alone and a first
    // resolve that failed on a network error would render neither the
    // "Link unavailable" message nor an editor — a blank frame with no
    // explanation. `undefined` is what `useQuery` reports as `data` before
    // any success.
    for (const err of [offline, restarting, verdict, expired]) {
      expect(isShareLinkResolveFatal(err, undefined)).toBe(true);
    }
  });

  it("is never fatal without an error", () => {
    // Guards against the collapse to `Boolean(error)`'s mirror image: the
    // pre-resolve render (`isLoading` handles it) and every successful
    // refetch must both fall through to the editor.
    expect(isShareLinkResolveFatal(undefined, resolvedLink)).toBe(false);
    expect(isShareLinkResolveFatal(null, resolvedLink)).toBe(false);
    expect(isShareLinkResolveFatal(undefined, undefined)).toBe(false);
  });
});

describe("shouldRetryShareLinkResolve", () => {
  it("retries a failure that carries no verdict exactly once", () => {
    for (const err of [offline, restarting]) {
      expect(shouldRetryShareLinkResolve(0, err)).toBe(true);
      expect(shouldRetryShareLinkResolve(1, err)).toBe(false);
    }
  });

  it("never retries the server's verdict", () => {
    // Re-asking an answered question only delays closing a view whose
    // authority is gone.
    for (const err of [verdict, expired]) {
      expect(shouldRetryShareLinkResolve(0, err)).toBe(false);
    }
  });
});
