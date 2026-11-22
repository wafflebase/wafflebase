/* eslint-disable @typescript-eslint/no-unused-vars -- stub; the implementation lands separately */
/**
 * Standard Webhooks signing: HMAC-SHA256 over `id.timestamp.body`, one
 * `v1,<base64>` signature per live secret so a receiver keeps verifying
 * through a rotation. See https://www.standardwebhooks.com/.
 *
 * STUB — the contract below is fixed; the implementation lands separately.
 */

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
  throw new Error('not implemented');
}

/** The `webhook-id`, `webhook-timestamp` and `webhook-signature` headers. */
export function signWebhook(_input: SignInput): Record<string, string> {
  throw new Error('not implemented');
}

/**
 * Verify headers the way a receiver would. For tests and the docs snippet;
 * `toleranceSeconds` defaults to the recommended 5 minutes.
 */
export function verifyWebhook(_input: {
  headers: Record<string, string>;
  body: string;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  throw new Error('not implemented');
}
