/**
 * Removing capability tokens from URLs before they leave the browser.
 *
 * Several of this app's URLs *are* credentials: `/shared/:token` and
 * `/invite/:token` grant access to anyone holding them, and an `unlisted`
 * template id is 122 bits of capability for the same reason
 * (`docs/design/sharing.md`, `docs/design/template-gallery.md`). Sentry's
 * browser SDK attaches `location.href` to every event it sends, and
 * `sendDefaultPii: false` does not touch it — that option governs IPs,
 * cookies and headers. So without this, opening a share link and hitting any
 * error mails the share token to a third party, where it is retained and
 * searchable.
 *
 * No imports, and a pure function, because `sentry.ts` runs it inside
 * `beforeSend` on every event.
 */

/**
 * Replaces the segment AFTER each of these with a placeholder.
 *
 * Compared case-INSENSITIVELY. React Router matches paths case-insensitively
 * by default, so `/Shared/<token>` renders the share route and works; a
 * case-sensitive check here would render it and still ship the token.
 */
const CAPABILITY_PREFIXES = ["shared", "invite", "t"];

/** Query parameters that carry a capability rather than a preference. */
const CAPABILITY_PARAMS = ["token", "confirm", "state", "code"];

// Underscores rather than brackets: `URLSearchParams.set` percent-encodes
// `[` and `]`, which would put `%5Bredacted%5D` in front of whoever reads the
// event. Still unmistakably not a token.
const PLACEHOLDER = "__redacted__";

/**
 * Returns `url` with any capability token replaced.
 *
 * Unparseable input is returned unchanged rather than dropped: a malformed URL
 * is not evidence of a token, and losing the field entirely would cost more
 * debugging than it buys. Relative URLs are handled — Sentry breadcrumbs carry
 * those — by parsing against a throwaway base and re-emitting only what came
 * in.
 */
/** `%73hared` is `shared`. Undecodable input is compared as it arrived. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function redactCapabilityTokens(url: string): string {
  if (!url) return url;

  let parsed: URL;
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(url);
  try {
    parsed = new URL(url, relative ? "http://redact.invalid" : undefined);
  } catch {
    return url;
  }

  const segments = parsed.pathname.split("/");
  for (let i = 0; i < segments.length - 1; i += 1) {
    const prefix = decodeSegment(segments[i]).toLowerCase();
    if (CAPABILITY_PREFIXES.includes(prefix) && segments[i + 1]) {
      segments[i + 1] = PLACEHOLDER;
    }
  }
  parsed.pathname = segments.join("/");

  for (const [name] of [...parsed.searchParams]) {
    if (CAPABILITY_PARAMS.includes(name.toLowerCase())) {
      parsed.searchParams.set(name, PLACEHOLDER);
    }
  }

  if (!relative) return parsed.toString();
  // A protocol-relative reference names a host of its own, so dropping it would
  // rewrite `//host/shared/tok` as a path on this origin. Keep it.
  const authority = url.startsWith("//") ? `//${parsed.host}` : "";
  // Rebuild rather than slicing off the throwaway origin, so a pathname that
  // happens to contain the host string is not mangled.
  return `${authority}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * URL-shaped spans inside free text: an absolute `http(s)://…`, or a path
 * beginning at a `/`. Stops at whitespace and at the characters that normally
 * close a URL in prose or in serialized output — quotes, angle brackets,
 * brackets, parentheses, commas — so `(/shared/abc)` yields `/shared/abc`.
 *
 * A backslash is deliberately INSIDE the span rather than a delimiter. Any
 * serializer that escapes forward slashes (PHP's `json_encode` by default, log
 * pipelines that re-escape an already-JSON string) writes a share link as
 * `\/shared\/tok`; treating `\` as the end of a span would cut that into
 * `\/shared` and `\/tok`, neither of which is a prefix followed by a token, and
 * the capability would ship unredacted. `unescapeSlashes` below undoes the
 * escaping before parsing, since `new URL()` reads `\` as an authority
 * delimiter.
 */
const URL_SPAN = /https?:\/\/[^\s"'`<>()[\]{},]*|[/\\][^\s"'`<>()[\]{},]+/gi;

/**
 * Whether a span could possibly hold a capability at all — built from the two
 * lists above so it cannot drift from them. `%` counts because a prefix or a
 * parameter name may arrive percent-encoded (`/%73hared/…`), which only
 * `redactCapabilityTokens`'s decode step resolves.
 *
 * This is what the span budget below is spent on. Without it, the budget was
 * consumed by every `/` in the text — `2026/11/25`, `1/2`, `src/lib/x.ts` are
 * all spans — so a line with a few dates ahead of the URL exhausted it before
 * reaching the token.
 */
const CAPABILITY_HINT = new RegExp(
  `%|[\\\\/](?:${CAPABILITY_PREFIXES.join("|")})[\\\\/]|[?&](?:${CAPABILITY_PARAMS.join(
    "|"
  )})=`,
  "i"
);

/**
 * How many capability-shaped spans are parsed before the rest are replaced
 * wholesale. Free text is not a URL, so there is a ceiling on the work this
 * does; it sits far above any real log line and exists so a megabyte of
 * accidentally-stringified state cannot make `beforeSend` the slow part of an
 * error path.
 */
const MAX_SPANS = 256;

/** `\/shared\/tok` → `/shared/tok`. See `URL_SPAN`. */
function unescapeSlashes(span: string): string {
  return span.replace(/\\\//g, "/");
}

/**
 * Returns `text` with any capability token inside a URL-shaped span replaced.
 *
 * `redactCapabilityTokens` above is a URL function: it parses its WHOLE input,
 * so handing it `"load failed: /documents/x/file?token=t"` comes back with the
 * prose percent-encoded. This finds the URL-ish parts and rewrites only those.
 *
 * A span is substituted only when its redaction actually changed something.
 * Otherwise an ordinary `/w/jiyu` in a log line would still be rewritten — by
 * `new URL()` normalization rather than by us — which is noise in the one
 * field a human reads to understand the error.
 *
 * There is no ceiling on the length of the text: a long string is scanned like
 * any other, and only the number of capability-shaped spans that get PARSED is
 * bounded. Past that bound a span is replaced in full rather than passed
 * through, so exhausting the budget costs context and never a token — the
 * length cap this used to have failed the other way, returning a megabyte of
 * stringified state with its tokens intact.
 */
export function redactUrlsInText(text: string): string {
  if (!text) return text;
  if (!text.includes("/")) return text;

  let spans = 0;
  return text.replace(URL_SPAN, (span) => {
    if (!CAPABILITY_HINT.test(span)) return span;
    if (spans >= MAX_SPANS) return PLACEHOLDER;
    spans += 1;
    const escaped = span.includes("\\/");
    const redacted = redactCapabilityTokens(
      escaped ? unescapeSlashes(span) : span
    );
    if (!redacted.includes(PLACEHOLDER)) return span;
    // Put the escaping back, so a redacted span still reads like the
    // serialized form it came out of.
    return escaped ? redacted.replace(/\//g, "\\/") : redacted;
  });
}
