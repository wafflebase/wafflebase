/**
 * The development host: where a report goes, and who writes its issue text.
 *
 * Both endpoints are served by the Vite plugin
 * (`packages/debug-report/src/plugin/report-endpoint.ts`), which
 * means the model credential is read in the DEV-SERVER PROCESS and never reaches
 * the browser. In SP2 the backend re-hosts the same two calls, and because they
 * sit behind `HostAdapter` that is a substitution rather than a rewrite.
 *
 * Design: `docs/design/debug-report.md`, *The `HostAdapter` seam*.
 */

import type {
  Bundle,
  CapturePayload,
  DebugItem,
  Environment,
  HostAdapter,
  Point,
  SendResult,
  Target,
} from "../index";
import { readEnvironment } from "../index";


export const REPORT_ENDPOINT = "/__wb_debug_report";
export const DRAFT_ENDPOINT = "/__wb_debug_draft";

/**
 * The theme a report was observed in.
 *
 * Read from the document rather than from a store, because what matters is what
 * was on the screen — a "the contrast here is wrong" report is about the theme
 * that was actually painted.
 */
function currentTheme(): string {
  const root = document.documentElement;
  return (
    root.dataset.theme ??
    (root.classList.contains("dark") ? "dark" : undefined) ??
    (typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light")
  );
}

/**
 * The client gives up before the server does.
 *
 * Without this the panel could wait forever: a dev server stopped mid-flight
 * leaves the promise unsettled, and the batch un-sendable — which would make
 * drafting the hard dependency this design says it is not.
 */
const DRAFT_TIMEOUT_MS = 60_000;

/**
 * The same rule for the handover, with more room.
 *
 * THE SEND HAD NO TIMEOUT AT ALL, and the drafting one being right made that
 * easy to miss: a dev server stopped mid-upload left the promise unsettled and
 * the button stuck on "Sending…", with no way back to the batch except
 * reloading the page — which is exactly when the reports are still only in the
 * session.
 *
 * Longer than drafting because this one carries the images: up to the store's
 * 32 MB budget, base64-expanded. Aborting is safe at any point, because the
 * endpoint writes nothing until it has read and validated the whole body — a
 * cut-off upload leaves no half-written bundle behind.
 */
const REPORT_TIMEOUT_MS = 120_000;

async function postJson(
  url: string,
  body: unknown,
  timeoutMs?: number,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const controller = timeoutMs === undefined ? undefined : new AbortController();
  const timer =
    controller === undefined
      ? undefined
      : setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (err) {
    if (timer !== undefined) clearTimeout(timer);
    if (controller?.signal.aborted) {
      return { ok: false, error: `no answer within ${timeoutMs}ms` };
    }
    return {
      ok: false,
      error: `the dev server did not answer (${err instanceof Error ? err.message : String(err)})`,
    };
  }
  // THE TIMER STAYS ARMED THROUGH THE BODY. `fetch` resolves once the headers
  // arrive, so clearing it here left `response.json()` waiting forever on a
  // stalled body — and an unsendable batch is exactly what the timeout exists to
  // prevent. `abort()` rejects the body read too, which is why one timer covers
  // both halves.
  let data: unknown;
  let aborted = false;
  try {
    data = await response.json();
  } catch {
    // A body that never arrived and a body that is not JSON are different
    // answers: the first is the timeout doing its job and must say so.
    aborted = controller?.signal.aborted ?? false;
    data = undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (aborted) return { ok: false, error: `no answer within ${timeoutMs}ms` };
  if (!response.ok) {
    const detail =
      data && typeof data === "object"
        ? [
            (data as { error?: unknown }).error,
            (data as { detail?: unknown }).detail,
          ]
            .filter((part) => typeof part === "string")
            .join(": ")
        : "";
    return { ok: false, error: detail || `HTTP ${response.status}` };
  }
  return { ok: true, data };
}

export type DevHostOptions = {
  /** The anonymised route, supplied by the mount that knows it. */
  route: () => string;
  /**
   * Point → semantic address for a Canvas surface.
   *
   * The host's, for the same reason `DebugOverlay`'s `locateOnCanvas` prop is:
   * only the mounted engine can say which cell a point is, and this package must
   * not know which engines a consumer has.
   */
  locateOnCanvas?: (point: Point) => Target | undefined;
  documentType?: () => string | undefined;
  role?: () => string | undefined;
};

export function createDevHost(options: DevHostOptions): HostAdapter {
  const environment = (): Environment =>
    readEnvironment({
      route: options.route(),
      // Stamped by the build when it is available. Absent is reported as absent
      // — an agent reading the wrong code because a bundle implied a SHA is
      // worse than one that knows it does not know.
      ...(import.meta.env.VITE_BUILD_SHA
        ? { buildSha: String(import.meta.env.VITE_BUILD_SHA) }
        : {}),
      theme: currentTheme(),
      ...(options.documentType?.() ? { documentType: options.documentType() } : {}),
      ...(options.role?.() ? { role: options.role() } : {}),
    });

  return {
    route: options.route,
    buildSha: () =>
      import.meta.env.VITE_BUILD_SHA
        ? String(import.meta.env.VITE_BUILD_SHA)
        : undefined,
    theme: currentTheme,
    environment,

    async locate(point: Point): Promise<Target | undefined> {
      // The HOST supplies this, for the same reason `locateOnCanvas` is a prop:
      // only the mounted engine can turn a point into an address, and this
      // package must not know which engines a consumer has. Omitted, the
      // adapter simply cannot name a canvas point — the overlay then falls back
      // to a region, which is the honest answer.
      return options.locateOnCanvas?.(point);
    },

    async draft(items: readonly DebugItem[]): Promise<unknown> {
      const answer = await postJson(
        DRAFT_ENDPOINT,
        { bundle: { items, env: environment() } },
        DRAFT_TIMEOUT_MS,
      );
      // Thrown rather than returned: `requestDrafts` turns this into the
      // "unavailable" state the panel renders. The answer is returned raw —
      // `parseDraftResult` is the only thing allowed to interpret it.
      if (!answer.ok) throw new Error(answer.error);
      return answer.data;
    },

    async send(
      bundle: Bundle,
      captures: readonly CapturePayload[],
    ): Promise<SendResult> {
      const answer = await postJson(
        REPORT_ENDPOINT,
        { bundle, captures },
        REPORT_TIMEOUT_MS,
      );
      if (!answer.ok) return { ok: false, error: answer.error };
      const ref = (answer.data as { ref?: unknown } | undefined)?.ref;
      const refused = (answer.data as { refused?: unknown } | undefined)?.refused;
      if (typeof ref !== "string") {
        return { ok: false, error: "the dev server did not say where it wrote" };
      }
      // A refused capture is surfaced as a failure of the send, not swallowed:
      // the reporter confirmed a bundle that included those images.
      if (Array.isArray(refused) && refused.length > 0) {
        return {
          ok: false,
          error: `wrote ${ref}, but refused ${refused.length} capture(s) — the bundle and the images disagree`,
        };
      }
      return { ok: true, ref };
    },
  };
}
