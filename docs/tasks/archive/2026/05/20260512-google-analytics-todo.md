---
title: Add Google Analytics (GA4) to the frontend
date: 2026-05-12
status: in-progress
---

# Google Analytics (GA4) integration

Wire GA4 (`G-1Q13HY79ST`) into the frontend so production traffic is
observable. Dev/preview/localhost should stay out of the property to
avoid polluting reports.

## Plan

- [x] Add a `VITE_GA_ID` placeholder to the frontend `index.html` head
      and replace it from a Vite `transformIndexHtml` plugin that reads
      `loadEnv(mode, ...)`. When the env var is missing the tag block
      is stripped entirely (dev → no script, no requests).
- [x] Add a tiny `AnalyticsTracker` component that lives inside
      `<Router>` and emits `gtag('event', 'page_view', { page_path })`
      on `useLocation()` change. SPA route changes are not auto-tracked
      by gtag, so this is required.
- [x] Set `VITE_GA_ID=G-1Q13HY79ST` in
      `packages/frontend/.env.production` only. Leave dev `.env` empty.
- [x] Cover the `/docs` VitePress site too: read `VITE_GA_ID` via
      `loadEnv` in `.vitepress/config.ts` and push gtag head tags.
      Gate on `process.env.NODE_ENV === "production"` since
      `vitepress build` sets it before the config evaluates and
      `vitepress dev` leaves it unset. Add a matching
      `packages/documentation/.env.production`. VitePress is SSG, so
      every rendered .md page fires the initial `page_view`;
      client-side nav between docs pages is not separately tracked,
      which is acceptable for the docs site (small page count).
- [x] `pnpm verify:fast` and confirm pass.

## Non-goals

- GDPR/PIPA consent banner — defer until policy decision.
- Custom event tracking (button clicks, formula runs, etc.) — defer.
- Google Tag Manager (GTM) — direct gtag is simpler at current scale.
