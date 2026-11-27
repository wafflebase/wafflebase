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

