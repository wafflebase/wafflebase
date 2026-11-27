# Desktop app download guidance — lessons

## B: docs page

- Google desktop sign-in is not shipped: `GET /auth/providers` hard-codes
  `desktop.google: false` and the shell intercepts only `/auth/github`. A
  brief said "Google where the server offers it"; no server offers it yet, so
  the page says GitHub only. Check the code, not the plan, for Phase 2 items.
- The VitePress build reports dead page links but not dead `#anchors`. Check
  anchors in the built HTML (`id="…"`) — one stale anchor already existed in
  `start/troubleshooting.md` (`50-mb` for a heading that says 100 MB).
- A user error message belongs in `start/troubleshooting.md` as a
  symptom-titled entry (STYLE.md), linked from the how-to, rather than a
  troubleshooting section inside the how-to page.
- Headless screenshots taken right after a viewport resize catch VitePress
  mid-transition (sidebar half off-screen); re-navigate at the target size
  before judging layout.

## A: homepage

- **The homepage's docs-link guard only read `.tsx`.** A docs path kept in a
  `.ts` constant (`desktop-download.ts`) slipped past
  `docs-links.test.ts`; widened it to `.ts`. That also means surface A's
  verify gate fails until surface B's `start/desktop.md` exists — A cannot be
  committed green on its own, so land A and B together (or B first).
- **iPadOS says it is a Mac.** `navigator.platform` is `MacIntel` and the UA
  is desktop Safari; only `maxTouchPoints > 1` tells it apart. Platform
  detection that only reads `platform` would push a `.dmg` at an iPad.
- **jsdom has no `navigator.maxTouchPoints`**, so `vi.spyOn(navigator,
  "maxTouchPoints", "get")` throws; define it with `Object.defineProperty`
  (configurable) and delete it after each test.
- **A signed-out homepage screenshot needs no backend**: route
  `http://localhost:3000/**` to a 401 in Playwright. Routing a pattern like
  `/api/` also catches Vite's own `/src/api/*.ts` modules and blanks the
  page. `capture-before-after.mjs shoot` always signs in, which redirects `/`
  to a workspace, so it cannot shoot the signed-out homepage.
