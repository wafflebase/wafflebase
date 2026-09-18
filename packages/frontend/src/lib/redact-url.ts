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

/** Replaces the segment AFTER each of these with a placeholder. */
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
    if (CAPABILITY_PREFIXES.includes(segments[i]) && segments[i + 1]) {
      segments[i + 1] = PLACEHOLDER;
    }
  }
  parsed.pathname = segments.join("/");

  for (const param of CAPABILITY_PARAMS) {
    if (parsed.searchParams.has(param)) {
      parsed.searchParams.set(param, PLACEHOLDER);
    }
  }

  if (!relative) return parsed.toString();
  // Rebuild rather than slicing off the throwaway origin, so a pathname that
  // happens to contain the host string is not mangled.
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
