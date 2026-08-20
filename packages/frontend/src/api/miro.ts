import { fetchWithAuth } from "@/api/auth";
import { assertOk } from "@/api/http-error";
import { seg } from "@/api/url";
import { createNdjsonLineReader } from "@/api/ndjson";
import type { MiroItemLike, MiroConnectorLike } from "@wafflebase/board";

export interface MiroImportNote {
  reason: string;
  itemType?: string;
  count: number;
}

export interface MiroImportResult {
  items: MiroItemLike[];
  connectors: MiroConnectorLike[];
  notes: MiroImportNote[];
}

/** The phases the backend reports, in the order they run. */
export type MiroImportStage = "items" | "connectors" | "images";

/**
 * One progress tick. `done` is a running total within the stage, not a delta;
 * `total` is present only for `images`, where the workload is known up front.
 */
export interface MiroImportProgress {
  stage: MiroImportStage;
  done: number;
  total?: number;
}

/**
 * A failure the server reported IN-BAND, after it had already committed to a
 * 200 by writing the first progress line.
 *
 * It is a distinct class from `HttpError` because it is a genuinely different
 * thing: `HttpError` carries a status the server chose for the failure, and
 * here there is none — the status says 200 and means "the stream opened", not
 * "the import worked". Callers still treat it exactly like a thrown request
 * failure; only code that switches on `.status` needs to tell them apart.
 */
export class MiroImportStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MiroImportStreamError";
  }
}

/** One NDJSON line of the import stream. */
type MiroImportEvent =
  | ({ type: "progress" } & MiroImportProgress)
  | ({ type: "result" } & MiroImportResult)
  | { type: "error"; message: string };

const FALLBACK_ERROR = "Failed to import the Miro board";

/**
 * Ask the backend to read a Miro board on the user's behalf, and wait until
 * the response has committed to a status.
 *
 * The token is sent once and used server-side only — it is never stored here,
 * never put in the URL (which would land in logs/history), and never written
 * into the document. The response is a stream, which is what keeps that "once"
 * true: a job-id + polling design would have to either park the credential on
 * the server or resend it with every poll.
 *
 * ## Two error surfaces, deliberately — and why this is two functions
 *
 * The server does the work that can fail with a meaningful status (board-id
 * parsing, the first authenticated Miro call) BEFORE writing a byte:
 *
 * - **Before the stream** the response is a normal non-2xx, so it goes through
 *   the shared `assertOk` and arrives as an `HttpError` with `.status` and
 *   `.retryAfterMs` — unchanged from when this endpoint returned plain JSON.
 *   Those are the failures the user can fix from the form they still have open
 *   (a rejected token, no access, a board that does not exist), and they are
 *   exactly the ones this function rejects with.
 * - **After the stream opens** the status is committed to 200 and a failure
 *   can only be an `{"type":"error"}` line, which `readMiroImportStream`
 *   throws as a `MiroImportStreamError`.
 *
 * Splitting the request in two at that seam lets a caller hand the two halves
 * to different places: awaiting `openMiroImportStream` tells it the import is
 * genuinely underway (so it can dismiss its form and report the rest
 * elsewhere), while `readMiroImportStream` is the long-running part. The token
 * is only needed by this half — nothing downstream of it has to hold the
 * credential.
 */
export async function openMiroImportStream(
  workspaceId: string,
  payload: { token: string; boardUrl: string },
): Promise<Response> {
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/workspaces/${seg(workspaceId)}/miro/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  await assertOk(res, FALLBACK_ERROR);
  return res;
}

/**
 * Drain an opened import stream, reporting progress as it arrives and
 * resolving with the terminal `result` line.
 *
 * Rejects with a `MiroImportStreamError` on an in-band `{"type":"error"}` line
 * or on a stream that ends without a result, so a caller's `catch` sees a
 * failure the same way it would from `openMiroImportStream`.
 */
export async function readMiroImportStream(
  res: Response,
  onProgress?: (progress: MiroImportProgress) => void,
): Promise<MiroImportResult> {
  // A holder rather than a bare `let`: TypeScript's flow analysis ignores
  // assignments made inside a callback, and would otherwise narrow the
  // variable to `null` at the check below.
  const state: { result: MiroImportResult | null } = { result: null };

  // Called as each line COMPLETES, not after the body is drained — buffering
  // the whole stream first would deliver every progress tick at once and make
  // the streaming pointless.
  const handle = (line: string): void => {
    let event: MiroImportEvent;
    try {
      event = JSON.parse(line) as MiroImportEvent;
    } catch {
      // A malformed line is not worth failing an otherwise good import over —
      // the terminal `result` line is what decides success, and its absence is
      // caught below.
      return;
    }
    if (event.type === "progress") {
      onProgress?.({
        stage: event.stage,
        done: event.done,
        total: event.total,
      });
    } else if (event.type === "result") {
      // Copied field by field rather than spread-minus-`type`: the value goes
      // straight into `mapMiroItems`, and the envelope tag has no business
      // travelling with it.
      state.result = {
        items: event.items,
        connectors: event.connectors,
        notes: event.notes ?? [],
      };
    } else if (event.type === "error") {
      throw new MiroImportStreamError(event.message || FALLBACK_ERROR);
    }
  };

  await readNdjsonLines(res, handle);

  if (!state.result) {
    // The connection ended without the terminal line: a dropped socket, a
    // proxy timeout, a killed worker. Silently resolving with an empty board
    // would import an empty document and call it a success.
    throw new MiroImportStreamError(
      "The Miro import ended before it finished — please try again",
    );
  }
  return state.result;
}

/**
 * Drive `onLine` over an NDJSON body as it arrives.
 *
 * Streaming is the point, so the reader path is the real one; the `text()`
 * fallback covers a response with no readable body (an environment without
 * streaming `fetch`, or a test double), where reading it whole is still
 * correct — just without live progress.
 */
async function readNdjsonLines(
  res: Response,
  onLine: (line: string) => void,
): Promise<void> {
  const body = res.body as
    | (ReadableStream<Uint8Array> & {
        getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
      })
    | null
    | undefined;

  if (!body || typeof body.getReader !== "function") {
    for (const line of (await res.text()).split("\n")) {
      const trimmed = line.trim();
      if (trimmed) onLine(trimmed);
    }
    return;
  }

  const reader = body.getReader();
  const parser = createNdjsonLineReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) for (const line of parser.push(value)) onLine(line);
    }
    for (const line of parser.flush()) onLine(line);
  } catch (err) {
    // An in-band error line throws out of `onLine`. Stop pulling and hand the
    // socket back rather than leaving it draining in the background.
    await reader.cancel?.().catch(() => {});
    throw err;
  }
}
