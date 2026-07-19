export class HttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) to ms. */
export function parseRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return undefined;
}

type StatusMessages = Record<number, string>;

type AssertOkOptions = {
  statusMessages?: StatusMessages;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pickMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const fromMessage = asNonEmptyString(record.message);
  if (fromMessage) {
    return fromMessage;
  }

  const messageList = record.message;
  if (Array.isArray(messageList)) {
    const parts = messageList
      .map(asNonEmptyString)
      .filter((part): part is string => Boolean(part));
    if (parts.length > 0) {
      return parts.join(", ");
    }
  }

  return asNonEmptyString(record.error);
}

/**
 * Reads the best-effort error message from a failed HTTP response body.
 */
export async function readResponseErrorMessage(
  response: Response,
): Promise<string | null> {
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const mayBeJson =
    contentType.includes("application/json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[");

  if (mayBeJson) {
    try {
      const parsed = JSON.parse(trimmed);
      const fromPayload = pickMessageFromPayload(parsed);
      if (fromPayload) {
        return fromPayload;
      }
    } catch {
      // Fallback to raw text below.
    }
  }

  return trimmed;
}

/**
 * Throws an Error when response is not OK, with status override priority.
 */
export async function assertOk(
  response: Response,
  fallbackMessage: string,
  options: AssertOkOptions = {},
): Promise<void> {
  if (response.ok) {
    return;
  }

  const retryAfterMs = parseRetryAfterMs(response);
  const override = options.statusMessages?.[response.status];
  if (override) {
    throw new HttpError(override, response.status, retryAfterMs);
  }

  const bodyMessage = await readResponseErrorMessage(response);
  throw new HttpError(
    bodyMessage || fallbackMessage,
    response.status,
    retryAfterMs,
  );
}
