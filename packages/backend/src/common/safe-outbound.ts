/**
 * The SSRF guard for requests to user-supplied URLs (webhooks first; the
 * datasource `host` later). Checked at registration **and** on every send:
 * https only, every resolved address refused if private, the connection
 * pinned to the address that was checked, redirects never followed, response
 * size capped. See `docs/design/webhooks.md` § SSRF guard.
 *
 * Nothing here logs, and no error message carries the URL: a webhook URL is
 * often itself a credential (Zapier, Slack and n8n put the secret in the
 * path).
 */
import { promises as dnsPromises } from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { StringDecoder } from 'node:string_decoder';

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

// --- Address classification -------------------------------------------------

interface Cidr {
  family: 4 | 6;
  bytes: Uint8Array;
  prefix: number;
}

function parseIPv4(address: string): Uint8Array | null {
  if (isIP(address) !== 4) return null;
  return Uint8Array.from(address.split('.').map(Number));
}

/** 16 bytes, or null. Zone ids (`fe80::1%eth0`) are refused, not stripped. */
function parseIPv6(address: string): Uint8Array | null {
  if (isIP(address) !== 6 || address.includes('%')) return null;
  let text = address;
  const tail: number[] = [];
  // A dotted IPv4 tail (`::ffff:1.2.3.4`) is two groups.
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (!v4) return null;
    tail.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    // `::ffff:1.2.3.4` → `::ffff`; `::1.2.3.4` → `::`.
    text = text.slice(0, lastColon + 1);
    if (!text.endsWith('::')) text = text.slice(0, -1);
  }
  const [head, rest] = text.split('::') as [string, string | undefined];
  const groups = (s: string | undefined) =>
    s
      ? s
          .split(':')
          .filter((g) => g !== '')
          .map((g) => parseInt(g, 16))
      : [];
  const left = groups(head);
  const right = [...groups(rest), ...tail];
  const fill = rest === undefined ? 0 : 8 - left.length - right.length;
  const all = [...left, ...new Array<number>(fill).fill(0), ...right];
  if (all.length !== 8) return null;
  const bytes = new Uint8Array(16);
  all.forEach((g, i) => {
    bytes[i * 2] = g >> 8;
    bytes[i * 2 + 1] = g & 0xff;
  });
  return bytes;
}

function parseCidr(cidr: string): Cidr | null {
  const [address, prefixText, extra] = cidr.trim().split('/');
  if (extra !== undefined || !prefixText || !/^\d+$/.test(prefixText)) {
    return null;
  }
  const prefix = Number(prefixText);
  const v4 = parseIPv4(address);
  if (v4) return prefix <= 32 ? { family: 4, bytes: v4, prefix } : null;
  const v6 = parseIPv6(address);
  if (v6) return prefix <= 128 ? { family: 6, bytes: v6, prefix } : null;
  return null;
}

function inCidr(bytes: Uint8Array, cidr: Cidr): boolean {
  if (bytes.length !== cidr.bytes.length) return false;
  const whole = Math.floor(cidr.prefix / 8);
  for (let i = 0; i < whole; i++) {
    if (bytes[i] !== cidr.bytes[i]) return false;
  }
  const bits = cidr.prefix % 8;
  if (bits === 0) return true;
  const mask = (0xff << (8 - bits)) & 0xff;
  return (bytes[whole] & mask) === (cidr.bytes[whole] & mask);
}

function cidrs(list: string[]): Cidr[] {
  return list.map((c) => parseCidr(c)).filter((c): c is Cidr => c !== null);
}

/**
 * Not globally routable: loopback, "this network", RFC 1918, CGNAT,
 * link-local (which holds the cloud metadata address 169.254.169.254), IETF
 * protocol assignments, documentation and benchmarking nets, multicast, the
 * reserved block and broadcast.
 */
const BLOCKED_V4 = cidrs([
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
]);

const BLOCKED_V6 = cidrs([
  '::/128',
  '::1/128',
  '64:ff9b:1::/48', // local-use NAT64
  '100::/64', // discard
  '2001::/23', // IETF protocol assignments, incl. Teredo
  '2001:db8::/32', // documentation
  'fc00::/7', // unique local
  'fe80::/10', // link-local
  'fec0::/10', // deprecated site-local
  'ff00::/8', // multicast
]);

/**
 * IPv6 forms that carry an IPv4 address the packet ends up at. Each is judged
 * by the embedded address, so `::ffff:127.0.0.1` is loopback and
 * `64:ff9b::a9fe:a9fe` is the metadata service through a NAT64 gateway.
 */
const EMBEDDED_V4: { cidr: Cidr; offset: number }[] = [
  { cidr: parseCidr('::ffff:0:0/96')!, offset: 12 }, // IPv4-mapped
  { cidr: parseCidr('::/96')!, offset: 12 }, // IPv4-compatible (deprecated)
  { cidr: parseCidr('64:ff9b::/96')!, offset: 12 }, // NAT64
  { cidr: parseCidr('2002::/16')!, offset: 2 }, // 6to4
];

/** Parsed address, with an IPv4-mapped IPv6 address folded to its IPv4. */
function toBytes(address: string): Uint8Array | null {
  const v4 = parseIPv4(address);
  if (v4) return v4;
  const v6 = parseIPv6(address);
  if (!v6) return null;
  return inCidr(v6, EMBEDDED_V4[0].cidr) ? v6.slice(12, 16) : v6;
}

/** True when `address` must not be reached. Unparseable counts as blocked. */
export function isBlockedAddress(address: string): boolean {
  const bytes = toBytes(address);
  if (!bytes) return true;
  if (bytes.length === 4) return BLOCKED_V4.some((c) => inCidr(bytes, c));
  if (BLOCKED_V6.some((c) => inCidr(bytes, c))) return true;
  for (const { cidr, offset } of EMBEDDED_V4) {
    if (!inCidr(bytes, cidr)) continue;
    const embedded = bytes.slice(offset, offset + 4);
    if (BLOCKED_V4.some((c) => inCidr(embedded, c))) return true;
  }
  return false;
}

function isAllowedByCidr(address: string, allowed: Cidr[]): boolean {
  const bytes = toBytes(address);
  return !!bytes && allowed.some((c) => inCidr(bytes, c));
}

/**
 * Hostnames refused by name, before DNS has a say: names that a cloud or a
 * resolver answers with something internal, so their resolved address is not
 * the whole story (`metadata.google.internal` can sit behind a resolver that
 * rewrites it). Let through only when every resolved address is inside an
 * operator-allowed CIDR.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.internal',
  'instance-data',
  'instance-data.ec2.internal',
]);

function isBlockedHostname(hostname: string): boolean {
  return (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.internal')
  );
}

// --- URL checks -------------------------------------------------------------

interface CheckedUrl {
  url: URL;
  /** Hostname without IPv6 brackets or a trailing dot, lower-cased. */
  host: string;
  /** Set when the host is an IP literal; then no DNS is involved. */
  literal: string | null;
}

function checkUrl(raw: string, opts: SafeOutboundOptions): CheckedUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeOutboundError('invalid_url', 'The URL is not valid');
  }
  if (url.protocol !== 'https:') {
    if (!(url.protocol === 'http:' && opts.allowHttp)) {
      throw new SafeOutboundError(
        'scheme_not_allowed',
        url.protocol === 'http:'
          ? 'Only https:// URLs are allowed'
          : 'Only http(s) URLs are allowed',
      );
    }
  }
  if (url.username || url.password) {
    throw new SafeOutboundError(
      'invalid_url',
      'URLs with a username or password are not allowed',
    );
  }
  // WHATWG parsing already canonicalises `0x7f.1` and friends to dotted IPv4.
  let host = url.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host) throw new SafeOutboundError('invalid_url', 'The URL has no host');
  return { url, host, literal: isIP(host) ? host : null };
}

/** Refuse unless every address is public or inside an allowed CIDR. */
function checkAddresses(
  host: string,
  addresses: string[],
  allowed: Cidr[],
): void {
  const byName = isBlockedHostname(host);
  for (const address of addresses) {
    if (isAllowedByCidr(address, allowed)) continue;
    if (byName || isBlockedAddress(address)) {
      throw new SafeOutboundError(
        'private_address',
        `The host resolves to a private address (${address})`,
        address,
      );
    }
  }
}

async function resolve(host: string): Promise<string[]> {
  let records: { address: string }[];
  try {
    records = await dnsPromises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SafeOutboundError('dns_failed', 'The host could not be resolved');
  }
  if (records.length === 0) {
    throw new SafeOutboundError('dns_failed', 'The host could not be resolved');
  }
  return records.map((r) => r.address);
}

async function resolveChecked(
  checked: CheckedUrl,
  allowed: Cidr[],
): Promise<string[]> {
  const addresses = checked.literal
    ? [checked.literal]
    : await resolve(checked.host);
  checkAddresses(checked.host, addresses, allowed);
  return addresses;
}

/**
 * Parse `url`, check its scheme, resolve every A/AAAA record and refuse it if
 * any is private. Returns the addresses that passed.
 */
export async function assertSafeUrl(
  url: string,
  opts: SafeOutboundOptions,
): Promise<{ addresses: string[] }> {
  const checked = checkUrl(url, opts);
  return { addresses: await resolveChecked(checked, cidrs(opts.allowedCidrs)) };
}

// --- Sending ----------------------------------------------------------------

/**
 * The `lookup` the socket connects with. It resolves again and re-applies the
 * check, so what the socket dials is an address that passed — a name that
 * answered public to `assertSafeUrl` and private a moment later (DNS
 * rebinding) is refused here rather than connected to.
 */
function pinnedLookup(checked: CheckedUrl, allowed: Cidr[]): LookupFunction {
  return (_hostname, options, callback) => {
    resolveChecked(checked, allowed).then(
      (addresses) => {
        const entries = addresses.map((address) => ({
          address,
          family: isIP(address),
        }));
        const wanted = options.family
          ? entries.filter((e) => e.family === options.family)
          : entries;
        if (wanted.length === 0) {
          callback(
            new SafeOutboundError(
              'dns_failed',
              'The host could not be resolved',
            ),
            '',
            0,
          );
        } else if (options.all) {
          (callback as unknown as (e: null, a: typeof wanted) => void)(
            null,
            wanted,
          );
        } else {
          callback(null, wanted[0].address, wanted[0].family);
        }
      },
      (err: Error) => callback(err, '', 0),
    );
  };
}

function flattenHeaders(
  headers: http.IncomingHttpHeaders,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

function networkError(err: unknown): SafeOutboundError {
  if (err instanceof SafeOutboundError) return err;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return new SafeOutboundError(
    'network',
    code ? `The request failed (${code})` : 'The request failed',
  );
}

/**
 * `assertSafeUrl`, then send with the connection pinned to a checked address.
 * A 3xx is returned as a status, never followed. Throws `SafeOutboundError`.
 */
export async function safeFetch(
  url: string,
  init: SafeFetchInit,
): Promise<SafeFetchResult> {
  const started = performance.now();
  const checked = checkUrl(url, init);
  const allowed = cidrs(init.allowedCidrs);

  return new Promise<SafeFetchResult>((resolvePromise, rejectPromise) => {
    let settled = false;
    let req: http.ClientRequest | undefined;
    const finish = (err: unknown, result?: SafeFetchResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        req?.destroy();
        rejectPromise(networkError(err));
      } else {
        resolvePromise(result!);
      }
    };
    // One deadline over DNS, connect, TLS and reading the response.
    const timer = setTimeout(
      () => finish(new SafeOutboundError('timeout', 'The request timed out')),
      init.timeoutMs,
    );

    // Checked before connecting so a refusal is a clean error, not a socket
    // error; the connect lookup checks again.
    resolveChecked(checked, allowed).then(() => {
      if (settled) return;
      const transport = checked.url.protocol === 'https:' ? https : http;
      const body = Buffer.from(init.body, 'utf8');
      req = transport.request(
        {
          protocol: checked.url.protocol,
          hostname: checked.literal ?? checked.host,
          port: checked.url.port || undefined,
          path: `${checked.url.pathname}${checked.url.search}`,
          method: init.method,
          headers: { ...init.headers, 'content-length': String(body.length) },
          // A fresh socket per request: a pooled one would skip the lookup.
          agent: false,
          lookup: pinnedLookup(checked, allowed),
          ...(checked.literal ? {} : { servername: checked.host }),
        },
        (res) => {
          const decoder = new StringDecoder('utf8');
          let excerpt = '';
          let received = 0;
          const done = () =>
            finish(null, {
              status: res.statusCode ?? 0,
              headers: flattenHeaders(res.headers),
              // Without `end()`, a multi-byte character cut by the cap is
              // dropped rather than replaced with U+FFFD.
              bodyExcerpt: excerpt,
              durationMs: Math.round(performance.now() - started),
            });
          res.on('data', (chunk: Buffer) => {
            if (settled) return;
            const room = init.maxResponseBytes - received;
            if (room > 0) excerpt += decoder.write(chunk.subarray(0, room));
            received += chunk.length;
            if (received >= init.maxResponseBytes) {
              done();
              res.destroy();
              req?.destroy();
            }
          });
          res.on('end', () => {
            excerpt += decoder.end();
            done();
          });
          res.on('error', (err) => finish(err));
        },
      );
      req.on('error', (err) => finish(err));
      req.end(body);
    }, finish);
  });
}
