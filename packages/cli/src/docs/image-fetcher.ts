import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { Agent, fetch as undiciFetch, request as undiciRequest } from 'undici';
import type { DocxImageFetcher } from '@wafflebase/docs';
import {
  SystemError,
  UserError,
  fetchOrThrow,
  httpError,
  redactUrl,
} from '../errors.js';

/** Resolve a hostname to every address it currently answers with. */
export type HostLookup = (hostname: string) => Promise<string[]>;

export interface ImageFetcherOptions {
  /**
   * Base URL of the Wafflebase API server. Used to resolve image
   * inlines whose `src` is a server-relative path (`/images/<id>`), and
   * as the one internal origin the fetcher is still allowed to request
   * (`--server http://localhost:3000` is the normal dev setup).
   */
  serverBase: string;
  /**
   * Optional `fetch` override — kept as a seam for tests. Defaults to
   * undici's `fetch` (see `defaultFetch`). The signature matches the
   * WHATWG fetch so a stub can be a plain async function without pulling
   * DOM types in.
   */
  fetch?: typeof globalThis.fetch;
  /** Optional hostname resolver — a seam for tests. Defaults to DNS. */
  lookup?: HostLookup;
}

/**
 * Resolve a possibly-relative image URL against the configured server
 * base. Mirrors `resolveImageUrl` in
 * `packages/frontend/src/app/docs/export-utils.ts` so the CLI and
 * browser agree on what counts as "absolute". The shared rule: any URL
 * that starts with a scheme (`http:`, `https:`, `data:`, `blob:`,
 * `file:`, ...) is left alone; everything else gets prefixed. Whether a
 * scheme is one the CLI will actually *dereference* is a separate
 * question, answered by `assertFetchableImageUrl` below.
 */
export function resolveImageUrl(url: string, serverBase: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const base = serverBase.replace(/\/$/, '');
  if (!base) return url;
  return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}

/** Schemes worth dereferencing: real network fetches plus inline bytes. */
const FETCHABLE_SCHEMES = new Set(['http:', 'https:', 'data:']);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/**
 * A document `src` the CLI refuses to request. Document content is
 * attacker-influenced — anyone who can edit or share a doc picks the
 * `src` — so a blocked URL is a problem with the document, not with the
 * environment; hence the user-error exit class.
 */
function blocked(reason: string): UserError {
  return new UserError('IMAGE_URL_BLOCKED', reason);
}

/** Hostnames that only ever name something inside the machine or LAN. */
function isInternalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.internal') ||
    h.endsWith('.local')
  );
}

/**
 * The literal address in a URL's `hostname`, or `null` when it is a name
 * that has to be resolved first. IPv6 arrives bracketed from the URL
 * parser. Name-shaped hosts deliberately do **not** go through the
 * address rules — `fc2.com` is a public site, not `fc00::/7`.
 */
function ipLiteral(hostname: string): string | null {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ? hostname : null;
}

function isPrivateIPv4(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved incl. 255.255.255.255
  return false;
}

/** The dotted quad packed into two 16-bit words, run through the v4 rules. */
function isPrivateEmbeddedIPv4(hi: number, lo: number): boolean {
  return isPrivateIPv4(hi >> 8, hi & 0xff, lo >> 8);
}

/**
 * Expand an IPv6 literal to its eight 16-bit words, folding a trailing
 * dotted quad (`::ffff:127.0.0.1`) into the same shape the hex form
 * (`::ffff:7f00:1`) produces — the two spellings are one address, and
 * matching on text alone lets one of them through.
 */
function parseIPv6(ip: string): number[] | null {
  if (!ip.includes(':')) return null;
  let text = ip;
  const v4 = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (v4) {
    const parts = v4[1].split('.').map(Number);
    if (parts.some((n) => n > 255)) return null;
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    text = `${text.slice(0, v4.index + 1)}${hi}:${lo}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }

  if (groups.length !== 8) return null;
  const words = groups.map((g) => parseInt(g, 16));
  return words.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)
    ? null
    : words;
}

/** Loopback, RFC1918, CGNAT, link-local, unique-local — in any spelling. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) return isPrivateIPv4(Number(v4[1]), Number(v4[2]), Number(v4[3]));

  const words = parseIPv6(ip.replace(/%.*$/, ''));
  if (!words) return false;
  if (words.slice(0, 5).every((w) => w === 0)) {
    // `::`, `::1` and the IPv4-mapped/-compatible range.
    if (words[5] === 0 && words[6] === 0 && words[7] <= 1) return true;
    if (words[5] === 0xffff || words[5] === 0) {
      return isPrivateEmbeddedIPv4(words[6], words[7]);
    }
  }
  const first = words[0] >> 8;
  if (first === 0xfc || first === 0xfd) return true; // fc00::/7
  if ((words[0] & 0xffc0) === 0xfe80) return true; // fe80::/10

  // Transition ranges carry an IPv4 address in later words and are
  // routed to it for real, so the v4 rules have to reach through them
  // too: on a host behind a NAT64 gateway, `64:ff9b::a9fe:a9fe` *is*
  // the metadata service, and matching only on the leading words would
  // wave it through.
  if (words[0] === 0x0064 && words[1] === 0xff9b) {
    // RFC 6052 well-known prefix (`64:ff9b::/96`); the sibling
    // `64:ff9b:1::/48` is local-use by definition, so it never resolves
    // to anything the CLI should dereference.
    if (words.slice(2, 6).every((w) => w === 0)) {
      return isPrivateEmbeddedIPv4(words[6], words[7]);
    }
    return true;
  }
  if (words[0] === 0x2002) {
    // 6to4 (RFC 3056): `2002:<v4>::/48`.
    return isPrivateEmbeddedIPv4(words[1], words[2]);
  }
  if (words[0] === 0x2001 && words[1] === 0x0000) {
    // Teredo (RFC 4380): server IPv4 in words 2-3, client IPv4 in words
    // 6-7 stored as the bitwise complement.
    return (
      isPrivateEmbeddedIPv4(words[2], words[3]) ||
      isPrivateEmbeddedIPv4(~words[6] & 0xffff, ~words[7] & 0xffff)
    );
  }
  return false;
}

/** The port a URL connects to, with the scheme's default filled in. */
function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

/**
 * Every address a URL's host currently answers with. A literal is its
 * own answer; a name that cannot be resolved is a **system** failure,
 * not an allow — the gate and the fetch resolve independently, so
 * returning here would let a host whose nameserver stalls on this
 * lookup and answers the connect-time one with `127.0.0.1` through.
 */
async function resolveHost(
  url: URL,
  lookup: HostLookup,
  target: string,
): Promise<string[]> {
  const literal = ipLiteral(url.hostname);
  if (literal) return [literal];

  let addresses: string[];
  try {
    addresses = await lookup(url.hostname);
  } catch (cause) {
    throw new SystemError(
      'NETWORK_ERROR',
      `Could not resolve the host of image URL ${redactUrl(target)}.`,
      { cause },
    );
  }
  if (addresses.length === 0) {
    throw new SystemError(
      'NETWORK_ERROR',
      `Could not resolve the host of image URL ${redactUrl(target)}.`,
    );
  }
  return addresses;
}

/**
 * Every address the configured API server currently answers with, as the
 * exemption set for the gate below. The frontend persists image `src`
 * values absolute
 * (`resolveImageUrl` in `packages/frontend/src/app/spreadsheet/image-upload.ts`),
 * so a dev or self-hosted document stores whatever the browser called
 * the server (`http://localhost:3000/...`) while the CLI may be pointed
 * at another spelling of it (`--server http://127.0.0.1:3000`).
 * Comparing origin strings would refuse those documents' own images;
 * comparing resolved identities does not, and grants nothing beyond the
 * server the CLI already sends its credentials to.
 */
async function serverAddresses(
  server: URL,
  lookup: HostLookup,
): Promise<Set<string>> {
  try {
    const addresses = await resolveHost(server, lookup, server.toString());
    return new Set(addresses.map((a) => a.toLowerCase()));
  } catch {
    // The server's own host is unresolvable — nothing to match against.
    return new Set();
  }
}

/**
 * Gate one image URL before it is requested, returning the addresses the
 * request is then **pinned** to (`null` for `data:`, which opens no
 * connection). Without this the exporters turn any document into an SSRF
 * probe: a `src` of `http://169.254.169.254/...` or `file:///etc/passwd`
 * would be fetched with the CLI's network position and the bytes
 * embedded in the PDF/DOCX/PPTX the victim then reads.
 *
 * The verdict is per **address**, not per URL: a host that answers with
 * the server's address *and* an unrelated one must not have the
 * private-address check skipped for the unrelated one. Every address
 * that is not the server's own is judged on its merits, and only the
 * addresses that pass are handed back — `pinnedAgent` then connects to
 * those and nothing else, so an address rejected here is unreachable
 * even if the name later resolves to it (DNS rebinding).
 */
export async function assertFetchableImageUrl(
  target: string,
  server: URL | null,
  lookup: HostLookup,
): Promise<string[] | null> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw blocked(`Refusing to fetch malformed image URL "${target}".`);
  }

  if (url.protocol === 'data:') return null;
  if (!FETCHABLE_SCHEMES.has(url.protocol)) {
    throw blocked(
      `Refusing to fetch image URL with scheme "${url.protocol}" (${redactUrl(target)}).`,
    );
  }

  // The configured server is the one internal listener still allowed —
  // `--server http://localhost:3000` is the normal dev setup, and a
  // self-hosted deployment stores absolute internal URLs. A different
  // port is a different listener, so only a port match is worth
  // resolving a name for; anything else that is plainly internal is
  // refused without asking a resolver about it.
  const mayBeServer =
    server !== null && effectivePort(url) === effectivePort(server);
  const internalHost = () =>
    blocked(
      `Refusing to fetch image URL on an internal host (${redactUrl(target)}).`,
    );
  const internalName = isInternalHostname(url.hostname);
  if (internalName && !mayBeServer) throw internalHost();

  const addresses = await resolveHost(url, lookup, target);
  const exempt =
    server && mayBeServer
      ? await serverAddresses(server, lookup)
      : new Set<string>();

  const allowed = addresses.filter(
    (a) =>
      exempt.has(a.toLowerCase()) || (!internalName && !isPrivateAddress(a)),
  );
  if (allowed.length === 0) {
    if (internalName) throw internalHost();
    throw blocked(
      ipLiteral(url.hostname)
        ? `Refusing to fetch image URL on an internal address (${redactUrl(target)}).`
        : `Refusing to fetch image URL that resolves to an internal address (${redactUrl(target)}).`,
    );
  }
  return allowed;
}

/**
 * A dispatcher that connects to `addresses` and to nothing else.
 *
 * The gate resolves the hostname itself, but `fetch` resolves it again at
 * connect time — two independent lookups, and an attacker-run nameserver
 * with a ~0s TTL can answer the first with a public address and the
 * second with `169.254.169.254`. Overriding the connector's `lookup` with
 * the already-approved answers closes that window: the connection can
 * only land on an address the gate cleared.
 */
function pinnedAgent(addresses: string[]): Agent {
  const entries = addresses.map((address) => ({
    address,
    family: isIP(address) === 6 ? 6 : 4,
  }));
  // undici asks with `{ all: true }` and wants the array form; the
  // single-answer shape is kept for any caller that does not.
  const lookup = (
    _hostname: string,
    options: { all?: boolean } | undefined,
    callback: (
      err: Error | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ): void => {
    if (options?.all) callback(null, entries);
    else callback(null, entries[0].address, entries[0].family);
  };
  return new Agent({
    connect: { lookup } as unknown as Agent.Options['connect'],
  });
}

/**
 * Whether the runtime filtered this response into an *opaque redirect*.
 *
 * `redirect: 'manual'` is specified to yield a response of type
 * `opaqueredirect` — status `0`, empty header list — which carries
 * neither the status nor the `Location` the redirect loop below needs.
 * undici (this CLI's transport, a direct dependency rather than whatever
 * the host runtime happens to ship) hands back the real response
 * instead, which is what makes hop-by-hop gating possible; the filtered
 * shape is nonetheless what the spec mandates, so detect it rather than
 * mistake it for a successful, empty image.
 */
function isOpaqueRedirect(res: Response): boolean {
  return res.type === 'opaqueredirect' || res.status === 0;
}

/**
 * Re-issue one hop through undici's low-level `request`, which performs
 * no response filtering and follows no redirects, and adapt the result
 * to a `Response`. Used only when the fetch layer opaque-filtered the
 * hop — without it a redirected image would be unfetchable on any
 * runtime that implements the filter.
 */
async function rawRequest(target: string, agent: Agent | null): Promise<Response> {
  let res: Awaited<ReturnType<typeof undiciRequest>>;
  try {
    // `request` follows no redirects of its own (that needs an explicit
    // `maxRedirections`), so the loop above keeps gating every hop.
    res = await undiciRequest(target, {
      method: 'GET',
      ...(agent ? { dispatcher: agent } : {}),
    });
  } catch (cause) {
    throw new SystemError(
      'NETWORK_ERROR',
      `Request to ${redactUrl(target)} failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  return new Response(Readable.toWeb(res.body) as ReadableStream<Uint8Array>, {
    status: res.statusCode,
    headers,
  });
}

/**
 * undici's own `fetch`, not the runtime's. The gate below pins each
 * request to the addresses it approved by passing an undici `Agent` as
 * the dispatcher, and only the matching implementation is guaranteed to
 * honor it — handing a userland dispatcher to a differently-versioned
 * built-in `fetch` fails the request outright on some runtimes and would
 * silently skip the pinning on others.
 */
const defaultFetch = undiciFetch as unknown as typeof globalThis.fetch;

const defaultLookup: HostLookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true })).map((a) => a.address);

/**
 * Build an `ImageFetcher` for the CLI export pipelines. The fetcher
 * downloads each unique image inline `src` once, returning a Blob the
 * exporter can embed verbatim (PDF) or stream into the DOCX zip.
 *
 * Backend's `GET /images/:id` is publicly readable, so we don't attach
 * an Authorization header — sending JWT cookies via the CLI isn't
 * possible anyway. Relative URLs resolve against `serverBase`; absolute
 * URLs (e.g., the canonical `https://api.wafflebase.io/images/...`
 * surfaced by `imageFetcher required` errors) pass through.
 *
 * Redirects are followed by hand so every hop is gated the same way as
 * the first — an allowed host that 302s to `169.254.169.254` is the
 * whole point of the check — and each hop connects only to the addresses
 * its own gate pass approved.
 *
 * A transport failure or a non-OK response is classified like every
 * other CLI request (`fetchOrThrow` / `httpError`) so an unreachable
 * image host exits `2` rather than looking like bad user input.
 */
export function createImageFetcher(opts: ImageFetcherOptions): DocxImageFetcher {
  const fetchImpl = opts.fetch ?? defaultFetch;
  const lookup = opts.lookup ?? defaultLookup;
  let server: URL | null = null;
  try {
    server = new URL(opts.serverBase);
  } catch {
    server = null;
  }

  return async (url: string): Promise<Blob> => {
    const resolved = resolveImageUrl(url, opts.serverBase);
    let target = resolved;

    for (let hop = 0; ; hop++) {
      const addresses = await assertFetchableImageUrl(target, server, lookup);
      const agent = addresses ? pinnedAgent(addresses) : null;
      try {
        let res = await fetchOrThrow(
          target,
          // `dispatcher` is undici's, not the DOM's — the pin travels on
          // the same init object the fetch implementation reads.
          {
            redirect: 'manual',
            ...(agent ? { dispatcher: agent } : {}),
          } as RequestInit,
          fetchImpl,
        );
        if (isOpaqueRedirect(res)) res = await rawRequest(target, agent);

        const location = res.headers.get('location');
        if (REDIRECT_STATUSES.has(res.status) && location) {
          if (hop >= MAX_REDIRECTS) {
            throw blocked(
              `Image fetch failed: too many redirects for ${redactUrl(resolved)}`,
            );
          }
          // Release the hop's connection before opening the next one;
          // an undrained body keeps the undici socket alive until GC.
          await res.body?.cancel().catch(() => {});
          target = new URL(location, target).toString();
          continue;
        }

        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          throw httpError(
            res.status,
            `Image fetch failed: ${res.status}${
              res.statusText ? ` ${res.statusText}` : ''
            } for ${redactUrl(target)}`,
          );
        }
        // Buffered before the agent goes away — `destroy()` would abort a
        // body that is still streaming.
        return await res.blob();
      } finally {
        void agent?.destroy().catch(() => {});
      }
    }
  };
}
