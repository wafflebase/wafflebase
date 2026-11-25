import * as Sentry from "@sentry/react";
import { backendOrigin } from "@/api/images";
import { redactCapabilityTokens } from "@/lib/redact-url";

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
 * An absolute URL, or a root-relative path, embedded in free text.
 *
 * The second alternative captures the character BEFORE the path and the
 * replacer puts it back, rather than using the obvious `(?<![\w:/])`
 * lookbehind. That is not style: `vite.config.ts` pins no `build.target`, so
 * Vite's default `baseline-widely-available` target includes Safari 16.0,
 * lookbehind only landed in Safari 16.4, and esbuild cannot transform regexp
 * syntax — the literal would ship verbatim. A regex literal that does not
 * parse is a SyntaxError at MODULE level, and `main.tsx` imports this file
 * before it renders anything, so the cost would be a blank app on those
 * browsers rather than a missing redaction.
 */
const URL_IN_TEXT =
  /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>\]]+|(^|[^\w:/])(\/[^\s"'<>\]]+)/gi;

/**
 * Redacts every URL-shaped run inside a string that is not itself a URL —
 * a serialized DOM element, a span description like `GET /api/v1/x?token=y`.
 */
function redactUrlsInText(text: string): string {
  return text.replace(
    URL_IN_TEXT,
    (match: string, before: string | undefined, path: string | undefined) =>
      // Only the root-relative alternative captures; the absolute-URL one
      // leaves both groups undefined and is redacted whole.
      path === undefined
        ? redactCapabilityTokens(match)
        : `${before ?? ""}${redactCapabilityTokens(path)}`,
  );
}

/**
 * Span attributes that hold a whole URL or a path. `browserTracingIntegration`
 * sets `http.url` on every `http.client` span and the `url.*` set on the
 * pageload span, and this app deliberately puts the raw share token in a query
 * string — `?token=` on share-scoped image and file requests — so these carry
 * the credential on an ordinary sampled transaction.
 */
const URL_SPAN_ATTRIBUTES = [
  "http.url",
  "url.full",
  "url.path",
  "http.fragment",
  "url.fragment",
];

/** The same, for attributes holding a bare `?a=b` query string. */
const QUERY_SPAN_ATTRIBUTES = ["http.query", "url.query"];

/**
 * Redacts a bare query string (`?token=x`). `redactCapabilityTokens` parses
 * URLs, so hang it off a root path and take the path back off again.
 */
function redactQueryString(query: string): string {
  if (!query.startsWith("?")) return redactUrlsInText(query);
  return redactCapabilityTokens(`/${query}`).slice(1);
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
    // `ui.click` / `ui.input` crumbs carry the serialized element in
    // `message`, attributes (aria-label, title, alt, name) included. It is
    // not a URL, so redact each URL-shaped run inside it.
    if (typeof crumb.message === "string") {
      crumb.message = redactUrlsInText(crumb.message);
    }
  }

  // The child spans of a transaction, and the half the transaction NAME does
  // not cover. A share-scoped image (`?token=`) or file download becomes a
  // `resource`/`http.client` span whose description IS the URL and whose
  // attributes repeat it, and those ride out through `beforeSendTransaction`
  // on every sampled transaction — the same leak as `event.transaction`, one
  // field over.
  for (const span of event.spans ?? []) {
    if (typeof span.description === "string") {
      span.description = redactUrlsInText(span.description);
    }
    const data = span.data;
    if (!data) continue;
    for (const key of URL_SPAN_ATTRIBUTES) {
      const value = data[key];
      if (typeof value === "string") data[key] = redactCapabilityTokens(value);
    }
    for (const key of QUERY_SPAN_ATTRIBUTES) {
      const value = data[key];
      if (typeof value === "string") data[key] = redactQueryString(value);
    }
  }

  return event;
}
