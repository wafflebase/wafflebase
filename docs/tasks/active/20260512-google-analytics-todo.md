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

- [ ] Add a `VITE_GA_ID` placeholder to the frontend `index.html` head
      and replace it from a Vite `transformIndexHtml` plugin that reads
      `loadEnv(mode, ...)`. When the env var is missing the tag block
      is stripped entirely (dev → no script, no requests).
- [ ] Add a tiny `AnalyticsTracker` component that lives inside
      `<Router>` and emits `gtag('event', 'page_view', { page_path })`
      on `useLocation()` change. SPA route changes are not auto-tracked
      by gtag, so this is required.
- [ ] Set `VITE_GA_ID=G-1Q13HY79ST` in
      `packages/frontend/.env.production` only. Leave dev `.env` empty.
- [ ] `pnpm verify:fast` and confirm pass.

## Non-goals

- GDPR/PIPA consent banner — defer until policy decision.
- Custom event tracking (button clicks, formula runs, etc.) — defer.
- Google Tag Manager (GTM) — direct gtag is simpler at current scale.
