import * as Sentry from "@sentry/react";
import { backendOrigin } from "@/api/images";

/**
 * Default share of transactions sampled for tracing. Deliberately not 1.0 —
 * a spreadsheet editor emits a lot of navigation and fetch activity, and the
 * trace quota is the first thing a real deployment runs out of. Override per
 * deployment with `VITE_SENTRY_TRACES_SAMPLE_RATE`.
 */
const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/**
 * Parses `VITE_SENTRY_TRACES_SAMPLE_RATE`, falling back to the default for
 * anything that is not a number in [0, 1]. A typo must not silently become
 * "sample everything" — that is the expensive direction.
 */
function tracesSampleRate(raw: string | undefined): number {
  if (!raw) return DEFAULT_TRACES_SAMPLE_RATE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_TRACES_SAMPLE_RATE;
  }
  return parsed;
}

/**
 * Initializes Sentry, or does nothing at all.
 *
 * `VITE_SENTRY_DSN` is OPTIONAL and empty by default, and empty means the SDK
 * is never initialized: no global handlers, no network request, no headers
 * attached to backend calls. That is the shape `VITE_GA_ID` already has in
 * `vite.config.ts`, for the same reason — a DSN baked in as a default would
 * make every fork and self-host report its users' errors into wafflebase's own
 * Sentry organization, with nothing failing visibly. The value belongs to the
 * deployment that uses it; see `.env.production.example`.
 *
 * Called from `main.tsx` before anything else, so a throw during bootstrap is
 * still captured.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  // `backendOrigin()` is the empty string on a same-origin deployment, where
  // there is no separate API host to name. Passing `[""]` would be actively
  // wrong rather than merely useless: Sentry matches these entries as
  // substrings, and every URL contains the empty string, so the SDK would
  // attach `sentry-trace`/`baggage` to requests bound for third-party hosts.
  // Omitting the option falls back to the SDK default — same-origin requests
  // and localhost — which is exactly right for that deployment.
  const origin = backendOrigin();

  Sentry.init({
    dsn,
    // Same string the backend reports, so one deploy's frontend and backend
    // events line up. Injected by `vite.config.ts` from the root package.json.
    release: __APP_VERSION__,
    environment:
      import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: tracesSampleRate(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE
    ),
    // Which outgoing requests carry `sentry-trace`/`baggage`, and so which
    // ones link a browser trace to the backend's. Our own API only: the
    // backend's `enableCors` allow-lists those two headers (`main.ts`), and
    // nobody else's server has been asked to accept them.
    ...(origin ? { tracePropagationTargets: [origin] } : {}),
    // Left at the default. Request bodies on this backend carry document
    // content and URLs carry share tokens, so turning PII on needs a scrubbing
    // policy first.
    sendDefaultPii: false,
  });
}
