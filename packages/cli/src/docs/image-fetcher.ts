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
  /**
   * Give up on an image that has not answered in this long. Document content
   * decides which host an export dials, so a host that accepts the connection
   * and then never answers would otherwise hang the export indefinitely.
   */
  timeoutMs?: number;
  /**
   * Refuse an image body larger than this. Same reason: a `src` the operator
   * never chose must not be able to stream gigabytes into the exporter's heap.
   */
  maxBytes?: number;
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

/** How long one image hop may take before the export gives up on it. */
const DEFAULT_IMAGE_TIMEOUT_MS = 30_000;

/**
 * Largest image body an export will read. Matches the backend's own image
 * upload cap (25 MB), so nothing wafflebase itself stored can exceed it.
 */
const DEFAULT_MAX_IMAGE_BYTES = 25 * 1024 * 1024;

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
    unwrapIpv4(host),
  );
  if (v4) {
    const [a, b, c] = [Number(v4[1]), Number(v4[2]), Number(v4[3])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    // 224/4 multicast and 240/4 reserved (which ends at the 255.255.255.255
    // broadcast address). Neither names a host an image can legitimately come
    // from, and both reach places on the local segment.
    if (a >= 224) return true;
    return false;
  }

  return isPrivateIpv6(host);
}

/**
 * IPv6 the other way round: instead of enumerating the non-public prefixes —
 * which is what let 6to4 and NAT64 spellings of the metadata endpoint through —
 * only *global unicast* (2000::/3) is public, and the two global-unicast
 * prefixes that embed or tunnel another address are unwrapped or refused.
 */
function isPrivateIpv6(host: string): boolean {
  if (!host.includes(':')) return false;

  // A leading `::` (or a bare `::`) parses to a zero first hextet, which is
  // outside 2000::/3 and therefore refused — `::`, `::1` and `64:ff9b::…`
  // (the NAT64 well-known prefix) all land here.
  const first = parseInt(host.split(':')[0] || '0', 16);
  if (!Number.isFinite(first)) return true;
  if (first < 0x2000 || first > 0x3fff) return true;

  // 6to4 (2002::/16) carries the tunnelled IPv4 address in the next two
  // hextets — `2002:a9fe:a9fe::` is the metadata endpoint wearing a v6 hat.
  if (first === 0x2002) {
    const parts = host.split(':');
    const embedded = hextetsToIpv4(parts[1], parts[2]);
    return embedded === undefined || isPrivateHost(embedded);
  }

  // Teredo (2001:0::/32) tunnels to an arbitrary IPv4 endpoint the same way,
  // and 2001:db8::/32 is documentation. Neither is a real image host.
  if (first === 0x2001) {
    const second = parseInt(host.split(':')[1] || '0', 16);
    if (second === 0 || second === 0xdb8) return true;
  }
  return false;
}

/** Two hextets as a dotted quad, or undefined when either is missing. */
function hextetsToIpv4(hi?: string, lo?: string): string | undefined {
  if (!hi || !lo) return undefined;
  const h = parseInt(hi, 16);
  const l = parseInt(lo, 16);
  if (!Number.isFinite(h) || !Number.isFinite(l)) return undefined;
  return [h >>> 8, h & 255, l >>> 8, l & 255].join('.');
}

/**
 * An IPv4-mapped IPv6 literal is the same address wearing a different
 * spelling, and `new URL()` rewrites the dotted form into hextets — WHATWG
 * turns `::ffff:169.254.169.254` into `::ffff:a9fe:a9fe`. Both spellings are
 * folded back to the dotted quad so one address check covers them.
 */
function unwrapIpv4(host: string): string {
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

/**
 * Whether this URL names the host the CLI is already talking to.
 *
 * Deliberately the *host*, not the origin: the frontend writes **absolute**
 * image URLs into document content (`resolveImageUrl` in
 * `packages/frontend/src/app/spreadsheet/image-upload.ts`), so a document
 * created against `http://localhost:3000` carries that URL verbatim, and an
 * export run with `--server https://localhost:3000`, `--server
 * http://localhost:8080`, or any other scheme/port spelling of the same
 * machine would otherwise have every one of its images refused. The operator
 * already pointed the CLI at this host; a second port on it is not a host they
 * did not choose. A *different* internal host still needs
 * `WAFFLEBASE_IMAGE_HOSTS`.
 */
function sameHostAsServer(url: URL, serverBase: string): boolean {
  try {
    const base = bareHostname(new URL(serverBase).hostname);
    return base !== '' && base === bareHostname(url.hostname);
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
  if (sameHostAsServer(url, serverBase)) return;
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
 * The addresses it validated are *returned*, not thrown away, because a check
 * whose answer is discarded is a check-then-connect race: `fetch` resolves the
 * name a second time, so a resolver the attacker controls can answer publicly
 * here and with `169.254.169.254` a millisecond later. `pinnedUrl` (below)
 * closes that for `http:` by dialling the address this function approved and
 * carrying the original name in the `Host` header, so the address checked is
 * the address connected to. `https:` is dialled by name — an IP literal has no
 * SNI and no matching certificate — and is left to TLS: a rebound internal
 * host would have to present a valid certificate for the attacker's name.
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
): Promise<string[]> {
  const url = new URL(resolved);
  if (url.protocol === 'data:') return [];
  if (sameHostAsServer(url, serverBase)) return [];
  if (isAllowedHost(url, allowedHosts)) return [];

  const host = bareHostname(url.hostname);
  // Literals were already decided by `assertFetchableImageUrl`; a resolver
  // would only hand the same address back, and there is no name to rebind.
  if (isIpLiteral(host)) return [];

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
  return addresses;
}

/**
 * Rewrite an `http:` URL to dial one of the addresses the guard just approved,
 * so DNS cannot answer differently between the check and the connection. The
 * caller sends the original `Host` header alongside, which is what keeps
 * name-based virtual hosts and the server's own routing working.
 *
 * Returns the URL unchanged when there is nothing to pin: `https:` (dialled by
 * name so the certificate can be validated), `data:`, an IP literal, or a host
 * the operator exempted — all of which hand back no addresses.
 */
function pinnedUrl(target: string, addresses: string[]): string {
  if (addresses.length === 0) return target;
  const url = new URL(target);
  if (url.protocol !== 'http:') return target;
  const address = addresses[0];
  url.hostname = address.includes(':') ? `[${address}]` : address;
  return url.toString();
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
 * the first request and again on every redirect target, with the approved
 * address pinned into the `http:` connection so DNS cannot change its answer
 * in between.
 *
 * Every hop is also bounded: `timeoutMs` per request and `maxBytes` on the
 * body, because which host is dialled and how much it sends are both decided
 * by document content.
 */
export function createImageFetcher(opts: ImageFetcherOptions): DocxImageFetcher {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const lookup = opts.lookup ?? defaultLookup;
  const allowedHosts =
    opts.allowedHosts ?? parseAllowedHosts(process.env[IMAGE_HOSTS_ENV]);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;

  /** Check a hop and return the URL to actually dial (address-pinned). */
  const guard = async (target: string): Promise<string> => {
    assertFetchableImageUrl(target, opts.serverBase, allowedHosts);
    const addresses = await assertResolvedHostIsPublic(
      target,
      opts.serverBase,
      allowedHosts,
      lookup,
    );
    return pinnedUrl(target, addresses);
  };

  return async (url: string): Promise<Blob> => {
    const resolved = resolveImageUrl(url, opts.serverBase);
    let dial = await guard(resolved);

    // `redirect: 'manual'` moves the hop into this loop so the guard runs on
    // every target. Left to `fetch`, an allowed public host could answer
    // `302 Location: http://169.254.169.254/...` and the export would GET the
    // instance-metadata endpoint with no check in between.
    let current = resolved;
    for (let hop = 0; ; hop++) {
      // `host` is only sent when the dial URL was pinned to an address — the
      // request then carries the name the document actually named, so virtual
      // hosts keep resolving to the right site.
      const res = await fetchImpl(dial, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        ...(dial === current
          ? {}
          : { headers: { host: new URL(current).host } }),
      });

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
        return readCappedBlob(res, current, maxBytes);
      }

      // Nothing reads a redirect's body, and an unread one holds its socket
      // open until the agent times out.
      await res.body?.cancel().catch(() => {});

      if (hop >= MAX_IMAGE_REDIRECTS) {
        throw new Error(
          `Too many redirects (>${MAX_IMAGE_REDIRECTS}) while fetching image ${resolved}`,
        );
      }
      // Relative `Location`s resolve against the *named* URL, never the
      // address-pinned one, so a redirect can't smuggle the pin into the name.
      const next = new URL(location, current).toString();
      dial = await guard(next);
      current = next;
    }
  };
}

/**
 * Read a response body, refusing one that exceeds `maxBytes`.
 *
 * `Blob.arrayBuffer()` on an unbounded response is a document-controlled
 * allocation: the `src` decides which host answers, so the host decides how
 * much of the exporting machine's memory to take. The declared length is
 * checked first (cheap, and rejects before a byte is read) and then the actual
 * stream, because `Content-Length` is a claim, not a fact.
 */
async function readCappedBlob(
  res: Response,
  url: string,
  maxBytes: number,
): Promise<Blob> {
  const tooLarge = () =>
    new Error(
      `Image at ${url} exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB ` +
        `limit an export will read.`,
    );

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  const type = res.headers.get('content-type') ?? '';
  // A stub (or a bodyless response) has nothing to stream; the declared-length
  // check above is all there is to apply.
  if (!res.body) return res.blob();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  // One flat copy rather than a chunk list, so the Blob does not depend on
  // DOM `BlobPart` typings the CLI's Node-only lib set does not carry.
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([merged], { type });
}
