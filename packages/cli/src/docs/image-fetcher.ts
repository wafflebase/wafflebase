import { lookup as dnsLookup } from 'node:dns/promises';
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
   * Non-public hosts the operator has explicitly opted into, on top of the
   * configured server. Defaults to `WAFFLEBASE_IMAGE_HOSTS` (comma-separated).
   * Entries are `host` or `host:port`; a portless entry matches any port.
   */
  allowedHosts?: string[];
  /**
   * Optional `fetch` override — kept as a seam for tests. Defaults to
   * the global `fetch`. The signature matches the WHATWG fetch so a
   * stub can be a plain async function without pulling DOM types in.
   */
  fetch?: typeof globalThis.fetch;
  /**
   * Optional hostname resolver — kept as a seam for tests. Defaults to the
   * OS resolver (`dns.lookup`), which is also what `fetch` connects through,
   * so the addresses checked here are the ones actually dialled.
   */
  lookup?: HostLookup;
}

/** Resolve a hostname to every address the OS would connect to. */
export type HostLookup = (hostname: string) => Promise<string[]>;

/**
 * Environment variable naming extra image origins an export may fetch from
 * even though they are not public. A self-hosted install can serve blobs from
 * an internal host that is not the API server (MinIO on `10.0.0.5:9000`, a
 * reverse proxy on a second port), and the operator — not the document — is
 * the one who knows that. Default empty: only the configured server is exempt.
 */
export const IMAGE_HOSTS_ENV = 'WAFFLEBASE_IMAGE_HOSTS';

/** Parse the comma-separated `WAFFLEBASE_IMAGE_HOSTS` form into entries. */
export function parseAllowedHosts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** How many `Location` hops an image fetch may take before giving up. */
const MAX_IMAGE_REDIRECTS = 5;

/** Statuses whose `Location` header `fetch` would otherwise follow for us. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
  // A trailing root label is the same name to every resolver, but the WHATWG
  // parser keeps it on a domain host — `http://localhost./x` has hostname
  // `localhost.`. Drop it before any name comparison, or the exact-match
  // loopback set below is one keystroke away from being bypassed.
  const host = bareHostname(hostname);
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

/** Whether the host is already an address, so no resolver can change it. */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/** Strip the brackets and the root label a host may carry. */
function bareHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
}

function sameOriginAsServer(url: URL, serverBase: string): boolean {
  try {
    return new URL(serverBase).origin === url.origin;
  } catch {
    return false;
  }
}

/**
 * Whether the operator listed this host. `host:port` pins one port;
 * a portless entry matches every port on that host.
 */
function isAllowedHost(url: URL, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return false;
  const host = url.host.toLowerCase().replace(/\.+$/, '');
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  return allowedHosts.some((h) => h === host || h === hostname);
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
 * in development — or a host the operator named in `WAFFLEBASE_IMAGE_HOSTS`,
 * which is how a split-origin self-hosted install (blobs on an internal
 * MinIO, a reverse proxy on a second port) keeps exporting.
 *
 * `createImageFetcher` re-runs this on every redirect target, because `fetch`
 * follows redirects itself and would otherwise let a public host hand the
 * export a `Location:` pointing at the metadata endpoint.
 *
 * This half only reads the URL. A *name* is only as safe as what it resolves
 * to, so `assertResolvedHostIsPublic` — which the fetcher runs next — asks the
 * resolver as well.
 */
export function assertFetchableImageUrl(
  resolved: string,
  serverBase: string,
  allowedHosts: string[] = [],
) {
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
  if (isAllowedHost(url, allowedHosts)) return;
  if (isPrivateHost(url.hostname)) {
    throw new Error(
      `Refusing to fetch image from a non-public address: ${url.host}. ` +
        `If this deployment really serves images from there, list it in ${IMAGE_HOSTS_ENV}.`,
    );
  }
}

/** The OS resolver — the same source `fetch` connects through. */
const defaultLookup: HostLookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

/**
 * The other half of the guard: refuse a name that *resolves* to a non-public
 * address.
 *
 * Checking the URL alone stops `http://169.254.169.254/...` and nothing else —
 * `http://169.254.169.254.nip.io/...` is a public name at wildcard DNS that
 * answers with the embedded literal, and `metadata.google.internal` or a bare
 * single-label intranet name are ordinary names too. All of them read as
 * public to a string check, so the export would GET them from the operator's
 * machine. Asking the resolver closes that, and it is the same resolver
 * (`getaddrinfo`) `fetch` will dial through.
 *
 * This is not DNS-rebinding-proof — a name whose record changes between this
 * lookup and the connection still wins the race, and closing that needs
 * connection pinning below `fetch`. It does mean an attack has to control a
 * resolver and win a race rather than type one extra label.
 *
 * A name that cannot be resolved is refused rather than fetched: `fetch` would
 * fail to connect anyway, so failing closed costs nothing and never leaves the
 * check silently skipped. Hosts the operator already exempted — the configured
 * server, `WAFFLEBASE_IMAGE_HOSTS` — are not resolved at all, which is what
 * keeps a local `--server` and a split-origin install working.
 */
export async function assertResolvedHostIsPublic(
  resolved: string,
  serverBase: string,
  allowedHosts: string[] = [],
  lookup: HostLookup = defaultLookup,
): Promise<void> {
  const url = new URL(resolved);
  if (url.protocol === 'data:') return;
  if (sameOriginAsServer(url, serverBase)) return;
  if (isAllowedHost(url, allowedHosts)) return;

  const host = bareHostname(url.hostname);
  // Literals were already decided by `assertFetchableImageUrl`; a resolver
  // would only hand the same address back.
  if (isIpLiteral(host)) return;

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new Error(
      `Refusing to fetch image from ${url.host}: its address could not be ` +
        `resolved, so there is no way to check that it is public.`,
    );
  }

  const priv = addresses.find((address) => isPrivateHost(address));
  if (priv) {
    throw new Error(
      `Refusing to fetch image from a non-public address: ${url.host} ` +
        `resolves to ${priv}. If this deployment really serves images from ` +
        `there, list it in ${IMAGE_HOSTS_ENV}.`,
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
 * `resolveImageUrl` and are then gated — by `assertFetchableImageUrl` on the
 * URL and `assertResolvedHostIsPublic` on what its host resolves to — before
 * the first request and again on every redirect target.
 */
export function createImageFetcher(opts: ImageFetcherOptions): DocxImageFetcher {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const lookup = opts.lookup ?? defaultLookup;
  const allowedHosts =
    opts.allowedHosts ?? parseAllowedHosts(process.env[IMAGE_HOSTS_ENV]);

  const guard = async (target: string) => {
    assertFetchableImageUrl(target, opts.serverBase, allowedHosts);
    await assertResolvedHostIsPublic(
      target,
      opts.serverBase,
      allowedHosts,
      lookup,
    );
  };

  return async (url: string): Promise<Blob> => {
    const resolved = resolveImageUrl(url, opts.serverBase);
    await guard(resolved);

    // `redirect: 'manual'` moves the hop into this loop so the guard runs on
    // every target. Left to `fetch`, an allowed public host could answer
    // `302 Location: http://169.254.169.254/...` and the export would GET the
    // instance-metadata endpoint with no check in between.
    let current = resolved;
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(current, { redirect: 'manual' });

      // A browser answers a `manual` redirect with an *opaque-redirect*
      // response: status 0, no headers, no body. Node's `fetch` (undici)
      // hands back the real 3xx, which is what makes this loop work — but if
      // the CLI is ever run somewhere that filters, say so instead of
      // reporting the target as `Image fetch failed: 0`.
      if (res.status === 0) {
        throw new Error(
          `Image fetch got an opaque redirect for ${current}: this runtime's ` +
            `fetch hides redirect targets, so they cannot be re-checked.`,
        );
      }

      const location = REDIRECT_STATUSES.has(res.status)
        ? res.headers.get('location')
        : null;

      if (!location) {
        if (!res.ok) {
          throw new Error(
            `Image fetch failed: ${res.status} ${res.statusText} for ${current}`,
          );
        }
        return res.blob();
      }

      // Nothing reads a redirect's body, and an unread one holds its socket
      // open until the agent times out.
      await res.body?.cancel().catch(() => {});

      if (hop >= MAX_IMAGE_REDIRECTS) {
        throw new Error(
          `Too many redirects (>${MAX_IMAGE_REDIRECTS}) while fetching image ${resolved}`,
        );
      }
      const next = new URL(location, current).toString();
      await guard(next);
      current = next;
    }
  };
}
