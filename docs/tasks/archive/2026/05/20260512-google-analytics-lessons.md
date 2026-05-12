---
title: Google Analytics integration — lessons
date: 2026-05-12
---

# Lessons

## VitePress: import `loadEnv` from `vitepress`, not `vite`

`@wafflebase/documentation` only depends on `vitepress` — `vite` is not
a direct dependency and is not hoisted into the package's
`node_modules`. Importing `loadEnv` from `"vite"` in
`.vitepress/config.ts` builds locally only if hoisting happens to
expose it, and breaks under strict pnpm. VitePress re-exports `loadEnv`
(`export { Plugin, loadEnv } from 'vite'` in its `index.d.ts`), so the
correct import is `import { loadEnv } from "vitepress"`.

## VitePress mode signalling differs from Vite's

In a normal Vite project the `config()` plugin hook receives the build
`mode`, so `loadEnv(mode, ...)` Just Works. `.vitepress/config.ts` has
no such hook — it's a static export, evaluated at startup. VitePress
signals mode out-of-band:

- `vitepress build` force-sets `process.env.NODE_ENV = "production"`
  **before** evaluating `config.ts`.
- `vitepress dev` (and `createServer`) leaves `NODE_ENV` unset.

So the gate must be `NODE_ENV === "production"` (treat anything else as
dev), not the more intuitive `NODE_ENV === "development"` check —
that would let `vitepress dev` fall through to production.

## SPA `page_view`: turn off auto, fire manually

GA4's default `send_page_view: true` fires once on bootstrap, but
React Router history changes don't re-trigger it — so only the first
route is ever recorded. The clean fix is to bootstrap with
`send_page_view: false` and call `gtag('event', 'page_view', ...)`
from a `useLocation()` effect. That single path covers both the
initial render and every subsequent navigation with no risk of
double-counting.

## `/docs` is a separate VitePress build

The frontend's Vite proxy makes `/docs` *feel* like one app in dev,
but production serves it from `packages/documentation/dist`. Any
head-level injection in the SPA never reaches it. New cross-cutting
concerns (analytics, fonts, CSP headers) need to be applied to **both**
`packages/frontend/index.html` and `.vitepress/config.ts` to cover the
full surface.
