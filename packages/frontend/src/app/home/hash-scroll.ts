/**
 * Scroll to the element a `/#<id>` link names, if it is on this page.
 *
 * The marketing nav and footer link `/#features` as a router `Link` rather
 * than a bare `#features` anchor, because they now also mount on `/templates`
 * and `/t/:id` where the fragment points at nothing — and the router carries a
 * `basename`, so a plain `<a href="/#features">` would miss it.
 *
 * That swap costs two behaviours a real anchor gave for free, and this covers
 * both:
 *
 * - Arriving from another route: the browser resolved the hash before the
 *   landing page existed, so nothing scrolls. `HomePage` calls this on hash
 *   change.
 * - Clicking the link while already parked on `/#features`: `Link` changes no
 *   location, so no effect re-runs and the page sits still — where the anchor
 *   would have scrolled back every time. The nav and footer call this from
 *   `onClick`.
 *
 * `requestAnimationFrame` lets the target lay out first; without it a
 * freshly-mounted landing page measures every section at y=0 and nothing
 * moves.
 */
export function scrollToHashTarget(id: string) {
  requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  });
}
