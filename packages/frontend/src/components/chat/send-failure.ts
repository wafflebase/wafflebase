import { HttpError } from "@/api/http-error";

/** Why a send failed, as its row reports it. */
export interface SendFailure {
  /** Text for the reader, or null when "Not sent" is all there is to say. */
  reason: string | null;
  /** Whether sending it again could succeed. */
  retryable: boolean;
}

/**
 * Sort a failed post into one the reader can retry and one they cannot.
 *
 * A 4xx refusal is the server's answer about this message — a body too long,
 * a channel gone or archived — and the same request will be refused again,
 * so it shows the server's reason with no Retry. A 429 says only "not now",
 * and a 408 that the request never arrived; both are worth another try. A
 * network failure or a 5xx carries no text written for a reader and may
 * well succeed next time. (A 401 never gets here: `fetchWithAuth` refreshes
 * the session or signs out.)
 */
export function classifySendFailure(err: unknown): SendFailure {
  if (!(err instanceof HttpError) || err.status >= 500) {
    return { reason: null, retryable: true };
  }
  if (err.status === 429 || err.status === 408) {
    return { reason: err.message || null, retryable: true };
  }
  return {
    reason: err.message || "The server refused this message.",
    retryable: false,
  };
}

/**
 * A new send's id, reused on every retry so the server can tell a retry from
 * a second message. `crypto.randomUUID` exists only in secure contexts, so a
 * plain-http deployment builds the same v4 UUID from `getRandomValues`.
 */
export function newClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
