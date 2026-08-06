import { lookup as dnsLookup } from 'node:dns/promises';
import type { DocxImageFetcher } from '@wafflebase/docs';
import { UserError, fetchOrThrow, httpError, redactUrl } from '../errors.js';

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
   * the global `fetch`. The signature matches the WHATWG fetch so a
   * stub can be a plain async function without pulling DOM types in.
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

function isPrivateIPv4(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
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
  if (v4) return isPrivateIPv4(Number(v4[1]), Number(v4[2]));

  const words = parseIPv6(ip.replace(/%.*$/, ''));
  if (!words) return false;
  if (words.slice(0, 5).every((w) => w === 0)) {
    // `::`, `::1` and the IPv4-mapped/-compatible range.
    if (words[5] === 0 && words[6] === 0 && words[7] <= 1) return true;
    if (words[5] === 0xffff || words[5] === 0) {
      return isPrivateIPv4(words[6] >> 8, words[6] & 0xff);
    }
  }
  const first = words[0] >> 8;
  if (first === 0xfc || first === 0xfd) return true; // fc00::/7
  if ((words[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  return false;
}

/**
 * Gate one image URL before it is requested. Without this the exporters
 * turn any document into an SSRF probe: a `src` of
 * `http://169.254.169.254/...` or `file:///etc/passwd` would be fetched
 * with the CLI's network position and the bytes embedded in the
 * PDF/DOCX/PPTX the victim then reads.
 *
 * Names are resolved before the verdict, so a hostname whose DNS record
 * points at loopback is refused too. The residual gap is rebinding
 * between this lookup and the connect; closing that needs a pinned
 * connection, which undici does not expose.
 */
export async function assertFetchableImageUrl(
  target: string,
  serverOrigin: string | null,
  lookup: HostLookup,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw blocked(`Refusing to fetch malformed image URL "${target}".`);
  }

  if (url.protocol === 'data:') return;
  if (!FETCHABLE_SCHEMES.has(url.protocol)) {
    throw blocked(
      `Refusing to fetch image URL with scheme "${url.protocol}" (${redactUrl(target)}).`,
    );
  }

  // The configured server is the one internal origin still allowed —
  // `--server http://localhost:3000` is the normal dev setup, and a
  // self-hosted deployment stores absolute internal URLs.
  if (serverOrigin && url.origin === serverOrigin) return;

  const literal = ipLiteral(url.hostname);
  if (literal) {
    if (isPrivateAddress(literal)) {
      throw blocked(
        `Refusing to fetch image URL on an internal address (${redactUrl(target)}).`,
      );
    }
    return;
  }

  if (isInternalHostname(url.hostname)) {
    throw blocked(
      `Refusing to fetch image URL on an internal host (${redactUrl(target)}).`,
    );
  }

  let addresses: string[];
  try {
    addresses = await lookup(url.hostname);
  } catch {
    // Unresolvable: let the fetch itself report it as a network error
    // rather than mislabelling a DNS outage as a blocked document.
    return;
  }
  if (addresses.some(isPrivateAddress)) {
    throw blocked(
      `Refusing to fetch image URL that resolves to an internal address (${redactUrl(target)}).`,
    );
  }
}

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
 * whole point of the check.
 *
 * A transport failure or a non-OK response is classified like every
 * other CLI request (`fetchOrThrow` / `httpError`) so an unreachable
 * image host exits `2` rather than looking like bad user input.
 */
export function createImageFetcher(opts: ImageFetcherOptions): DocxImageFetcher {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const lookup = opts.lookup ?? defaultLookup;
  let serverOrigin: string | null = null;
  try {
    serverOrigin = new URL(opts.serverBase).origin;
  } catch {
    serverOrigin = null;
  }

  return async (url: string): Promise<Blob> => {
    const resolved = resolveImageUrl(url, opts.serverBase);
    let target = resolved;

    for (let hop = 0; ; hop++) {
      await assertFetchableImageUrl(target, serverOrigin, lookup);
      const res = await fetchOrThrow(
        target,
        { redirect: 'manual' },
        fetchImpl,
      );

      const location = res.headers.get('location');
      if (REDIRECT_STATUSES.has(res.status) && location) {
        if (hop >= MAX_REDIRECTS) {
          throw blocked(
            `Image fetch failed: too many redirects for ${redactUrl(resolved)}`,
          );
        }
        target = new URL(location, target).toString();
        continue;
      }

      if (!res.ok) {
        throw httpError(
          res.status,
          `Image fetch failed: ${res.status} ${res.statusText} for ${redactUrl(target)}`,
        );
      }
      return res.blob();
    }
  };
}
