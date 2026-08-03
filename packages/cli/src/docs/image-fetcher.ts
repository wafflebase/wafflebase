import type { DocxImageFetcher } from '@wafflebase/docs';
import { fetchOrThrow, httpError, redactUrl } from '../errors.js';

export interface ImageFetcherOptions {
  /**
   * Base URL of the Wafflebase API server. Used to resolve image
   * inlines whose `src` is a server-relative path (`/images/<id>`).
   * Absolute URLs (`http(s)://...`, `data:`, `blob:`, ...) pass through
   * untouched so docs imported from external sources keep working.
   */
  serverBase: string;
  /**
   * Optional `fetch` override — kept as a seam for tests. Defaults to
   * the global `fetch`. The signature matches the WHATWG fetch so a
   * stub can be a plain async function without pulling DOM types in.
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Resolve a possibly-relative image URL against the configured server
 * base. Mirrors `resolveImageUrl` in
 * `packages/frontend/src/app/docs/export-utils.ts` so the CLI and
 * browser agree on what counts as "absolute". The shared rule: any URL
 * that starts with a scheme (`http:`, `https:`, `data:`, `blob:`,
 * `file:`, ...) is left alone; everything else gets prefixed.
 */
export function resolveImageUrl(url: string, serverBase: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const base = serverBase.replace(/\/$/, '');
  if (!base) return url;
  return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}

/**
 * An image `src` the CLI refuses to request. Document content is
 * attacker-influenced (anyone who can edit or share a doc picks the
 * `src`), so a blocked URL is a problem with the document, not with the
 * environment — hence the user-error exit class.
 */
export class BlockedImageUrlError extends Error {
  readonly code = 'IMAGE_URL_BLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'BlockedImageUrlError';
  }
}

/** Schemes worth dereferencing: real network fetches plus inline bytes. */
const FETCHABLE_SCHEMES = new Set(['http:', 'https:', 'data:']);

/**
 * Hostnames that only ever resolve inside the machine or its network:
 * loopback, RFC1918, CGNAT, link-local (which includes the cloud
 * metadata service at 169.254.169.254), and the `.internal` /
 * `.localhost` suffixes.
 */
function isInternalHost(hostname: string): boolean {
  let h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;

  // IPv6 loopback, unique-local (fc00::/7) and link-local (fe80::/10).
  if (h === '::1' || h === '::' || /^(fc|fd|fe8|fe9|fea|feb)/.test(h)) {
    return true;
  }
  // IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is the same address twice.
  if (h.startsWith('::ffff:')) h = h.slice('::ffff:'.length);

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * Gate a resolved image URL before it is requested. Without this the
 * exporters turn any document into an SSRF probe: a `src` of
 * `http://169.254.169.254/...` or `file:///etc/passwd` would be fetched
 * with the CLI's network position and the bytes embedded in the
 * PDF/DOCX/PPTX the victim then reads.
 *
 * The configured server is the one internal host we must still allow —
 * `--server http://localhost:3000` is the normal dev setup, and its
 * `/images/<id>` route is where legitimate inlines live.
 */
export function assertFetchableImageUrl(
  resolved: string,
  serverBase: string,
): void {
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    throw new BlockedImageUrlError(
      `Image src is not a valid URL: ${resolved}`,
    );
  }

  if (!FETCHABLE_SCHEMES.has(url.protocol)) {
    throw new BlockedImageUrlError(
      `Refusing to fetch image over "${url.protocol}" (${url.protocol}${url.pathname.slice(0, 40)}). Only http, https and data URLs are exported.`,
    );
  }

  if (url.protocol === 'data:') return;

  let serverHost: string | undefined;
  try {
    serverHost = new URL(serverBase).host;
  } catch {
    serverHost = undefined;
  }
  if (serverHost && url.host === serverHost) return;

  if (isInternalHost(url.hostname)) {
    throw new BlockedImageUrlError(
      `Refusing to fetch image from the internal address "${url.host}". Re-host the image on a public URL or on the configured server.`,
    );
  }
}

/**
 * Build an `ImageFetcher` for the CLI export pipelines. The fetcher
 * downloads each unique image inline `src` once, returning a Blob the
 * exporter can embed verbatim (PDF) or stream into the DOCX zip.
 *
 * Backend's `GET /images/:id` is publicly readable, so we don't attach
 * an Authorization header — sending JWT cookies via the CLI isn't
 * possible anyway. Relative URLs resolve against `serverBase`; absolute
 * URLs (e.g., the canonical `https://api.wafflebase.io/images/...`
 * surfaced by `imageFetcher required` errors) pass through
 * `assertFetchableImageUrl` first, which keeps a hostile `src` from
 * turning an export into an SSRF or a local-file read.
 */
export function createImageFetcher(opts: ImageFetcherOptions): DocxImageFetcher {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  return async (url: string): Promise<Blob> => {
    const resolved = resolveImageUrl(url, opts.serverBase);
    assertFetchableImageUrl(resolved, opts.serverBase);
    const res = await fetchOrThrow(resolved, undefined, fetchImpl);
    if (!res.ok) {
      throw httpError(
        res.status,
        `Image fetch failed: ${res.status} ${res.statusText} for ${redactUrl(resolved)}`,
      );
    }
    return res.blob();
  };
}
