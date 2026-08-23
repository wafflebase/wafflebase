/**
 * What a report is allowed to say about where it happened.
 *
 * Split from `mount.tsx` so that module exports only a component — Vite's fast
 * refresh degrades to a full reload otherwise, and a full reload while someone
 * is collecting reports would throw the batch away.
 */

/**
 * Document ids are anonymised out of the route.
 *
 * A report crosses a trust boundary — into `.wb-reports/` now, into a mailbox
 * later — and "which document" is rarely what makes a UI defect reproducible,
 * while being exactly what makes a bundle carry someone's private reference.
 */
export function anonymiseRoute(pathname: string, search = ""): string {
  const path = pathname
    .replace(/^\/(d|p|s|b|n|f)\/[^/]+/, "/$1/:id")
    .replace(/^\/w\/[^/]+/, "/w/:workspaceId")
    .replace(/^\/shared\/[^/]+/, "/shared/:token")
    // NOT anchored at the start: the real route is
    // `/w/:workspaceId/analytics/:id` (`App.tsx`), and an anchored rule never
    // matched it because the workspace rule had already moved `analytics` off
    // position 0 — so the raw document uuid travelled across the boundary this
    // function exists to guard.
    .replace(/(^|\/)analytics\/[^/]+/, "$1analytics/:id")
    .replace(/^\/invite\/[^/]+/, "/invite/:token");
  // A query string can carry a document id too (`?tab=`), but `?surface=` is
  // the harness selector and is load-bearing for a report, so keys are kept and
  // values are dropped only where they are opaque ids.
  const params = new URLSearchParams(search);
  const kept = Array.from(params.entries())
    .map(([k, v]) => `${k}=${/^[0-9a-f-]{16,}$/i.test(v) ? ":id" : v}`)
    .join("&");
  return kept ? `${path}?${kept}` : path;
}
