/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- stub; the implementation lands separately */
/**
 * The SSRF guard for requests to user-supplied URLs (webhooks first; the
 * datasource `host` later). Checked at registration **and** on every send:
 * https only, every resolved address refused if private, the connection
 * pinned to the address that was checked, redirects never followed, response
 * size capped. See `docs/design/webhooks.md` § SSRF guard.
 *
 * STUB — the contract below is fixed; the implementation lands separately.
 */

export type SafeOutboundErrorCode =
  | 'invalid_url'
  | 'scheme_not_allowed'
  | 'private_address'
  | 'dns_failed'
  | 'redirect'
  | 'timeout'
  | 'too_large'
  | 'network';

export class SafeOutboundError extends Error {
  constructor(
    readonly code: SafeOutboundErrorCode,
    message: string,
    /** The refused address, for errors that teach (`private_address`). */
    readonly address?: string,
  ) {
    super(message);
    this.name = 'SafeOutboundError';
  }
}

export interface SafeOutboundOptions {
  /** Exact CIDRs let through despite being private. */
  allowedCidrs: string[];
  /** Permit `http://`. */
  allowHttp: boolean;
}

export interface SafeFetchInit extends SafeOutboundOptions {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  /** The response body is read up to this and then cut off. */
  maxResponseBytes: number;
}

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string>;
  /** The first `maxResponseBytes` of the body, decoded as UTF-8. */
  bodyExcerpt: string;
  durationMs: number;
}

/**
 * Parse `url`, check its scheme, resolve every A/AAAA record and refuse it if
 * any is private. Returns the addresses that passed.
 */
export async function assertSafeUrl(
  _url: string,
  _opts: SafeOutboundOptions,
): Promise<{ addresses: string[] }> {
  throw new Error('not implemented');
}

/**
 * `assertSafeUrl`, then send with the connection pinned to a checked address
 * and `redirect: 'manual'`. A 3xx is returned as a status, never followed.
 * Throws `SafeOutboundError`.
 */
export async function safeFetch(
  _url: string,
  _init: SafeFetchInit,
): Promise<SafeFetchResult> {
  throw new Error('not implemented');
}
