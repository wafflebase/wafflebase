import * as Sentry from "@sentry/react";
import { backendOrigin } from "@/api/images";
import { redactCapabilityTokens, redactUrlsInText } from "@/lib/redact-url";

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

  // Nothing Sentry does is worth a blank page. `initSentry()` runs at module
  // top level in `main.tsx`, BEFORE `createRoot().render()` — so it is outside
  // the error boundary added in the same file, and earlier than the moment
  // that boundary begins to exist. A throw here (a malformed DSN, an
  // integration touching a browser API that is absent, a version skew after a
  // dependency bump) would therefore stop the app from mounting at all, which
  // is strictly worse than the state before error tracking was added. Swallow
  // it: an app running without reporting beats a reporting tool that bricks
  // the app.
  try {
    initClient(origin, dsn);
  } catch (err) {
    console.error("[sentry] initialization failed; continuing without it", err);
  }
}

function initClient(origin: string, dsn: string): void {
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
    // content, so turning PII on needs a policy for those first.
    sendDefaultPii: false,
    // BOTH hooks, and that is the whole point. `beforeSend` runs for error
    // events only; `browserTracingIntegration` two options up emits pageload
    // and navigation TRANSACTIONS, which carry the same URL and go out through
    // `beforeSendTransaction`. Installing one without the other leaves the
    // token on every sampled transaction — and `tracesSampleRate` defaults to
    // 0.1, so that is a normal deployment, not an edge case.
    beforeSend: scrubCapabilityTokens,
    beforeSendTransaction: scrubCapabilityTokens,
  });
}

/**
 * Strips share/invite/template tokens out of every event before it is sent.
 *
 * `sendDefaultPii: false` does NOT cover this — it governs IPs, cookies and
 * session data, while the browser SDK attaches `location.href` (and a
 * `Referer` taken from `document.referrer`) unconditionally. On a deployment
 * with a DSN set, every event raised while a user is on `/shared/<token>`
 * therefore hands that token, which is the whole credential, to a third party
 * that retains and indexes it.
 *
 * Applied at the send hooks rather than at each capture site, so it covers
 * what the SDK sends on its own — global handlers, breadcrumbs, navigation
 * transactions — not just the places this codebase calls `captureException`.
 *
 * Exported for the tests: the hooks are where this has to be right, and
 * testing only the pure helper would prove nothing about which fields are
 * actually reached.
 */
export function scrubCapabilityTokens<T extends Sentry.Event>(event: T): T {
  if (event.request?.url) {
    event.request.url = redactCapabilityTokens(event.request.url);
  }

  // `Referer` is filled from `document.referrer`, so navigating from a share
  // link to anywhere else carries the token into the NEXT page's events.
  // Header names arrive in whatever case the SDK used, so match loosely.
  const headers = event.request?.headers;
  if (headers) {
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === "referer" || name.toLowerCase() === "referrer") {
        headers[name] = redactCapabilityTokens(headers[name]);
      }
    }
  }

  // The route. For `/shared/:token` this is the raw path, and on a transaction
  // event it is the transaction's NAME — the thing the Sentry UI groups by.
  if (event.transaction) {
    event.transaction = redactCapabilityTokens(event.transaction);
  }

  for (const crumb of event.breadcrumbs ?? []) {
    // `navigation` crumbs carry `from`/`to`, `fetch`/`xhr` carry `url`.
    for (const key of ["url", "from", "to"]) {
      const value = crumb.data?.[key];
      if (typeof value === "string") {
        crumb.data![key] = redactCapabilityTokens(value);
      }
    }

    // Console instrumentation records the raw argument array beside the joined
    // `message`: `{ data: { arguments: args, logger: "console" } }`. Those
    // arguments are whatever a `console.error`/`console.warn` was handed, and
    // several of this app's URLs carry a capability as `?token=` — `fileUrl()`
    // in `api/files.ts`, the share-link image resolver in
    // `spreadsheet/image-cache.ts`. So an argument holding one of those URLs
    // ships the token with the next event. `crumb.message` — the joined form
    // of these same values — is a separate field and is NOT reached by this
    // hook yet; see the issue.
    const args = crumb.data?.arguments;
    if (Array.isArray(args)) {
      crumb.data!.arguments = args.map(redactArgument);
    }
  }

  return event;
}

/** How much of a console argument list is walked. See `redactArgument`. */
const MAX_ARGUMENTS = 16;
const MAX_ARGUMENT_FIELDS = 32;

/**
 * Redacts one console argument, one level deep and no further.
 *
 * Strings are rewritten; a plain object's own string-valued fields are
 * rewritten in place. Anything else — a number, a nested object, a DOM node, a
 * `Request` — is returned untouched, deliberately: serializing arbitrary
 * values here would turn a send hook into a traversal of application state,
 * and the SDK's own normalizer already decides what of it survives.
 *
 * The residual is therefore a token nested deeper than one level. That is the
 * same defence-in-depth posture the rest of this hook has: it bounds the
 * obvious paths rather than proving no path exists.
 *
 * Mutating the object is safe, and one level is not as shallow as it sounds,
 * for the same reason: the SDK runs `normalizeEvent` over every breadcrumb's
 * `data` BEFORE `beforeSend` (`@sentry/core`'s `prepareEvent`). So what
 * arrives here is a plain clone at `normalizeDepth` 3, not the live
 * application object the call site logged — an `Error` argument has already
 * become `{ message, name, stack }`, and anything deeper than a field of an
 * argument has already become the string `"[Object]"`.
 */
function redactArgument(arg: unknown, index: number): unknown {
  if (index >= MAX_ARGUMENTS) return arg;
  if (typeof arg === "string") return redactUrlsInText(arg);
  if (arg === null || typeof arg !== "object" || Array.isArray(arg)) return arg;

  const record = arg as Record<string, unknown>;
  let fields = 0;
  for (const key of Object.keys(record)) {
    if (fields >= MAX_ARGUMENT_FIELDS) break;
    fields += 1;
    const value = record[key];
    if (typeof value === "string") {
      record[key] = redactUrlsInText(value);
    }
  }
  return record;
}
