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

## Self-review

- **Round 1** (docs, correctness, security clean). Test-adequacy: the URL
  test restated its own constants, and nothing tied the homepage links to the
  workflow's uploads — fixed: `desktop-release.test.mjs` now checks every
  download link (README, docs guide, and the homepage's `${RELEASES}/…`
  pattern plus its `RELEASES` base) against the upload step, mutation-checked;
  the frontend test now checks each link shows the file it downloads. The
  client-hints test could pass without hints — fixed with a probe where every
  other signal says Mac. Design-fit / blast-radius "links 404 until 0.6.19":
  disputed — merge timing, recorded in Decisions; PR stays draft until the
  release.
- **Round 2** (all lenses but blast-radius clean; design-fit accepted the
  rebuttal). Blast-radius upheld "links 404 until 0.6.19": a merge-timing
  promise is not something the code enforces. Fixed by gating instead —
  `offerDesktopDownload()` also requires `__APP_VERSION__` ≥
  `FIRST_DESKTOP_RELEASE`, so an early merge shows nothing. Also made the
  scripts test's `RELEASES` match tolerant of a Prettier reformat and
  un-exported `PlatformProbe`. Lesson: when a reviewer rejects "we'll merge
  at the right time", look for the one-line guard that makes the timing not
  matter.
- **Round 3**: all six lenses clean; loop stopped.
