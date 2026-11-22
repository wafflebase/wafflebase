import { isIP } from 'net';

/**
 * Configuration and fixed limits for workspace webhooks. Kept free of Nest so
 * parsing can be tested without it, as `demo-reset-config.ts` is.
 * See `docs/design/webhooks.md`.
 */

/** At most this many webhooks per workspace (active or disabled). */
export const MAX_WEBHOOKS_PER_WORKSPACE = 10;
/** Deliveries per webhook per hour beyond which events are reported, not sent. */
export const HOURLY_DELIVERY_CAP = 1000;

/**
 * Seconds after the previous attempt (Svix's schedule): immediately, 5 s,
 * 5 m, 30 m, 2 h, 5 h, 10 h, 10 h — 8 attempts over about 32 h. Each delay
 * is jittered by ±{@link RETRY_JITTER}.
 */
export const RETRY_SCHEDULE_SECONDS = [
  0, 5, 300, 1800, 7200, 18000, 36000, 36000,
] as const;
export const MAX_ATTEMPTS = RETRY_SCHEDULE_SECONDS.length;
export const RETRY_JITTER = 0.1;
/** A `Retry-After` on a 429 is honoured up to this. */
export const RETRY_AFTER_CAP_MS = 60 * 60 * 1000;

export const DELIVERY_TIMEOUT_MS = 10_000;
/** How much of a response body is kept for the delivery log. */
export const RESPONSE_EXCERPT_BYTES = 1024;
/** Concurrent requests to one endpoint. */
export const MAX_IN_FLIGHT_PER_WEBHOOK = 2;
/** An `in_flight` row whose lease expires returns to `pending`. */
export const LEASE_MS = 60_000;
/** Rows claimed per worker tick. */
export const CLAIM_BATCH_SIZE = 50;
/** Poll interval; `LISTEN/NOTIFY` is the latency path, this the fallback. */
export const POLL_INTERVAL_MS = 5_000;
/** Delivery rows older than this are purged. */
export const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
/** `webhook_failing` once the current failure streak is this old. */
export const WARN_AFTER_FAILING_MS = 48 * HOUR_MS;
/**
 * Auto-disable once the streak is this old, and only once its warning went
 * out at least {@link DISABLE_AFTER_FAILING_MS} − {@link WARN_AFTER_FAILING_MS}
 * (a day) before.
 */
export const DISABLE_AFTER_FAILING_MS = 72 * HOUR_MS;
/**
 * A failure this long after the previous attempt starts a new streak rather
 * than continuing the old one. Longer than any retry gap (10 h ± 10 %, a
 * `Retry-After` of at most an hour), so a dead endpoint with work queued
 * keeps one unbroken streak.
 */
export const STREAK_BREAK_MS = 24 * HOUR_MS;

/** Payload `data` larger than this is refused at emit time. */
export const MAX_PAYLOAD_BYTES = 20 * 1024;

/** Secret rotation overlap, in hours. */
export const DEFAULT_ROTATION_OVERLAP_HOURS = 24;
export const MIN_ROTATION_OVERLAP_HOURS = 1;
export const MAX_ROTATION_OVERLAP_HOURS = 168;

export const DEFAULT_QUIET_MS = 60_000;
export const DEFAULT_MAX_WAIT_MS = 300_000;

/** The Postgres NOTIFY channel that wakes the delivery worker. */
export const WEBHOOK_NOTIFY_CHANNEL = 'webhook';

export interface WebhookConfig {
  /** `WAFFLEBASE_WEBHOOKS_ENABLED === 'true'`. Off, nothing is emitted or sent. */
  enabled: boolean;
  /** Ranges the SSRF guard lets through despite being private. */
  allowedCidrs: string[];
  /** Permit `http://` targets. */
  allowHttp: boolean;
  /** `content_updated` flushes once a document has been quiet this long… */
  quietMs: number;
  /** …or once this long has passed since the window opened. */
  maxWaitMs: number;
  /** This deployment's public API origin, for `api_url`. */
  apiOrigin?: string;
  /** The frontend origin, for `url`. */
  frontendOrigin?: string;
}

type Env = Record<string, string | undefined>;

/**
 * Read the `WAFFLEBASE_WEBHOOK*` settings. Every override fails closed on a
 * typo: only the literal `true` enables the feature or `http://`, and a CIDR
 * that does not parse is dropped rather than widened to something it did not
 * say.
 */
export function loadWebhookConfig(env: Env): WebhookConfig {
  return {
    enabled: env.WAFFLEBASE_WEBHOOKS_ENABLED?.trim() === 'true',
    allowedCidrs: parseCidrList(env.WAFFLEBASE_WEBHOOK_ALLOWED_CIDRS),
    allowHttp: env.WAFFLEBASE_WEBHOOK_ALLOW_HTTP?.trim() === 'true',
    quietMs: positiveInt(env.WAFFLEBASE_WEBHOOK_QUIET_MS, DEFAULT_QUIET_MS),
    maxWaitMs: positiveInt(
      env.WAFFLEBASE_WEBHOOK_MAX_WAIT_MS,
      DEFAULT_MAX_WAIT_MS,
    ),
    apiOrigin: originOf(env.WAFFLEBASE_API_ORIGIN || env.GITHUB_CALLBACK_URL),
    frontendOrigin: originOf(env.FRONTEND_URL),
  };
}

/**
 * A comma-separated list of exact CIDRs (`10.0.4.0/24`, `fd00::/8`). An entry
 * without a prefix length, with a prefix out of range, or with an address
 * that is not an IP literal is dropped.
 */
export function parseCidrList(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const cidr = normalizeCidr(entry);
    if (cidr && !out.includes(cidr)) out.push(cidr);
  }
  return out;
}

function normalizeCidr(entry: string): string | null {
  const trimmed = entry.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return null;
  const address = trimmed.slice(0, slash);
  const prefixText = trimmed.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const family = isIP(address);
  if (family === 0) return null;
  const prefix = Number(prefixText);
  if (prefix > (family === 4 ? 32 : 128)) return null;
  return `${address.toLowerCase()}/${prefix}`;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const text = raw?.trim();
  if (!text || !/^\d+$/.test(text)) return fallback;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function originOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** The frontend route prefix for each document type (see `App.tsx`). */
const DOCUMENT_ROUTE_PREFIX: Record<string, string> = {
  sheet: 's',
  doc: 'd',
  slides: 'p',
  note: 'n',
  board: 'b',
  pdf: 'f',
  image: 'f',
  file: 'f',
};

/** The editor link for a document, or `undefined` when unknown. */
export function documentUrl(
  config: Pick<WebhookConfig, 'frontendOrigin'>,
  document: { id: string; type: string },
): string | undefined {
  const prefix = DOCUMENT_ROUTE_PREFIX[document.type];
  if (!config.frontendOrigin || !prefix) return undefined;
  return `${config.frontendOrigin}/${prefix}/${encodeURIComponent(document.id)}`;
}

/** The `/api/v1` metadata link for a document, or `undefined` when unknown. */
export function documentApiUrl(
  config: Pick<WebhookConfig, 'apiOrigin'>,
  workspaceId: string,
  documentId: string,
): string | undefined {
  if (!config.apiOrigin) return undefined;
  return `${config.apiOrigin}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentId)}`;
}
