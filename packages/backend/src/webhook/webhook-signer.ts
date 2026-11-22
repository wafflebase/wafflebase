/**
 * Standard Webhooks signing: HMAC-SHA256 over `id.timestamp.body`, one
 * `v1,<base64>` signature per live secret so a receiver keeps verifying
 * through a rotation. See https://www.standardwebhooks.com/.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SECRET_PREFIX = 'whsec_';
const SECRET_BYTES = 32;
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface SignInput {
  /** The delivery id; the same on every retry. */
  id: string;
  /** Unix seconds, recomputed per attempt. */
  timestamp: number;
  body: string;
  /** `whsec_…` secrets, current first. */
  secrets: string[];
}

/** `'whsec_' + base64(32 random bytes)`. */
export function generateWebhookSecret(): string {
  return SECRET_PREFIX + randomBytes(SECRET_BYTES).toString('base64');
}

/**
 * The key bytes of a `whsec_` secret. The spec signs with the base64-decoded
 * part, not the string — a verifier that HMACs the string itself never
 * matches, which is the most common integration mistake.
 */
function secretKey(secret: string): Buffer {
  const encoded = secret.startsWith(SECRET_PREFIX)
    ? secret.slice(SECRET_PREFIX.length)
    : secret;
  const key = Buffer.from(encoded, 'base64');
  if (key.length === 0) throw new Error('Invalid webhook secret');
  return key;
}

function sign(secret: string, id: string, timestamp: number, body: string) {
  return createHmac('sha256', secretKey(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
}

/** The `webhook-id`, `webhook-timestamp` and `webhook-signature` headers. */
export function signWebhook(input: SignInput): Record<string, string> {
  if (input.secrets.length === 0) throw new Error('No webhook secret');
  const timestamp = Math.floor(input.timestamp);
  return {
    'webhook-id': input.id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': input.secrets
      .map((secret) => `v1,${sign(secret, input.id, timestamp, input.body)}`)
      .join(' '),
  };
}

/**
 * Verify headers the way a receiver would. For tests and the docs snippet;
 * `toleranceSeconds` defaults to the recommended 5 minutes.
 */
export function verifyWebhook(input: {
  headers: Record<string, string>;
  body: string;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  const header = (name: string) => {
    for (const [key, value] of Object.entries(input.headers)) {
      if (key.toLowerCase() === name) return value;
    }
    return undefined;
  };
  const id = header('webhook-id');
  const rawTimestamp = header('webhook-timestamp');
  const signatures = header('webhook-signature');
  if (!id || !rawTimestamp || !signatures) return false;
  if (!/^\d+$/.test(rawTimestamp)) return false;

  const timestamp = Number(rawTimestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = Buffer.from(sign(input.secret, id, timestamp, input.body));
  return signatures.split(' ').some((entry) => {
    const [version, signature] = entry.split(',', 2);
    if (version !== 'v1' || !signature) return false;
    const actual = Buffer.from(signature);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  });
}
