import type { DocxImageFetcher } from '@wafflebase/docs';

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

/** Schemes the export pipelines will actually fetch over the network. */
const FETCHABLE_SCHEMES = new Set(['http:', 'https:', 'data:']);

/** Hostnames that always name the machine running the CLI. */
const LOOPBACK_HOSTS = new Set(['localhost', '', '[::1]', '::1']);

/**
 * Literal addresses that are private, loopback, link-local, or otherwise
 * off the public internet. `169.254.169.254` — the cloud instance-metadata
 * endpoint — is the one that matters most, but the whole set is refused.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(
    unwrapIpv4Mapped(host),
  );
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  if (host === '::' || host === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // unique-local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // link-local fe80::/10
  return false;
}

/**
 * An IPv4-mapped IPv6 literal is the same address wearing a different
 * spelling, and `new URL()` rewrites the dotted form into hextets — WHATWG
 * turns `::ffff:169.254.169.254` into `::ffff:a9fe:a9fe`. Both spellings are
 * folded back to the dotted quad so one address check covers them.
 */
function unwrapIpv4Mapped(host: string): string {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (dotted) return dotted[1];

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!hex) return host;
  const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(
    '.',
  );
}

function sameOriginAsServer(url: URL, serverBase: string): boolean {
  try {
    return new URL(serverBase).origin === url.origin;
  } catch {
    return false;
  }
}

/**
 * Refuse to turn an export into a request the caller never asked for.
 *
 * An image `src` is *document content* — written by another workspace member,
 * by a shared doc, or by an agent — and `wafflebase docs export` fetches it
 * from the operator's machine, which typically sits inside a private network
 * or on a cloud instance with a metadata endpoint. So the two ways that
 * becomes an SSRF are closed: only `http`/`https`/`data` are fetched (no
 * `file:` reading local disk, no `blob:`, no exotic scheme), and a
 * non-public host is refused unless it is the server the CLI is already
 * talking to — which is what keeps `--server http://localhost:3000` working
 * in development.
 *
 * This is a scheme/address guard, not a full SSRF defense: a public hostname
 * that resolves to a private address still gets fetched, because catching
 * that needs DNS resolution plus connection pinning below `fetch`.
 */
export function assertFetchableImageUrl(resolved: string, serverBase: string) {
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    throw new Error(
      `Refusing to fetch image from a URL with no server to resolve it against: ${resolved}`,
    );
  }

  if (!FETCHABLE_SCHEMES.has(url.protocol)) {
    throw new Error(
      `Refusing to fetch image over "${url.protocol}" (allowed: http, https, data)`,
    );
  }
  if (url.protocol === 'data:') return;
  if (sameOriginAsServer(url, serverBase)) return;
  if (isPrivateHost(url.hostname)) {
    throw new Error(
      `Refusing to fetch image from a non-public address: ${url.host}`,
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
 * `resolveImageUrl` and are then gated by `assertFetchableImageUrl`.
 */
export function createImageFetcher(opts: ImageFetcherOptions): DocxImageFetcher {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  return async (url: string): Promise<Blob> => {
    const resolved = resolveImageUrl(url, opts.serverBase);
    assertFetchableImageUrl(resolved, opts.serverBase);
    const res = await fetchImpl(resolved);
    if (!res.ok) {
      throw new Error(
        `Image fetch failed: ${res.status} ${res.statusText} for ${resolved}`,
      );
    }
    return res.blob();
  };
}
