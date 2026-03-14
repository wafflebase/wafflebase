---
title: homepage
target-version: 0.1.0
---

# Homepage Landing Page

## Summary

Add a public-facing homepage to Wafflebase that introduces the product to general users and guides developers on REST API / CLI usage. Currently, unauthenticated visitors only see a login button. The new homepage replaces that with a full landing page.

## Goals

- Present Wafflebase's value proposition to first-time visitors
- Showcase key features (real-time collaboration, formulas, charts, datasources, sharing, open source)
- Provide developers with REST API and CLI code examples
- Embed a live demo spreadsheet via iframe (shared document)
- Support light/dark theme with system default detection
- Maintain the existing auth flow (Get Started → login → workspace)

## Non-Goals

- Pricing page or signup form (GitHub OAuth remains the only auth method)
- Separate documentation site (links to existing docs only)
- SEO optimization beyond basic meta tags

## Design

### Visual Style

Warm, brand-aligned color palette (amber/gold tones), defined as CSS custom properties in `index.css` and consumed via Tailwind utility classes:

```css
/* Added to index.css alongside existing theme variables */
--homepage-bg: oklch(0.99 0.02 88);        /* warm off-white */
--homepage-hero-end: oklch(0.96 0.06 88);   /* soft amber */
--homepage-text: oklch(0.45 0.12 55);       /* warm brown */
--homepage-text-secondary: oklch(0.50 0.13 70);
--homepage-accent: oklch(0.78 0.18 78);     /* amber gold */

/* .dark overrides */
--homepage-bg: oklch(0.18 0.02 55);
--homepage-hero-end: oklch(0.22 0.03 70);
--homepage-text: oklch(0.82 0.15 88);
--homepage-text-secondary: oklch(0.65 0.15 75);
```

The existing Tailwind class-based theme system (`light`/`dark` class on `<html>`) is used. No separate `[data-theme]` mechanism.

### Page Sections (top to bottom)

#### 1. Navigation Bar
- Left: `Grid2x2PlusIcon` (Lucide, same as app sidebar) + "Wafflebase" text, linked to `/`
- Right: Features / Developers anchor links (smooth scroll) + "Get Started" CTA button (links to `/login`)
- Nav bar is not sticky (static position)

#### 2. Hero Section
- Title: **"Super Simple Spreadsheet for Data Analysis"**
- Subtitle: "A collaborative, open-source spreadsheet with real-time editing, formulas, charts, and a powerful REST API & CLI for automation."
- Two CTA buttons:
  - "Get Started Free →" (primary) → links to `/login`
  - "View on GitHub →" (secondary outline) → links to GitHub repository URL

#### 3. Live Demo (iframe)
- Browser chrome frame (title bar with macOS-style dots)
- Embedded iframe pointing to same-origin shared document: `${window.location.origin}/shared/{token}?theme={light|dark}`
- Aspect ratio 16:9
- Label below: "Try it live — this is a real Wafflebase spreadsheet"
- Loading state: skeleton placeholder shown while iframe loads
- Error fallback: if iframe fails, show a static screenshot from `public/images/`
- **Theme sync**: initial load uses `?theme=` query param. Runtime theme changes use `postMessage` to avoid full iframe reload:
  ```js
  // Homepage sends:
  iframe.contentWindow.postMessage({ type: 'theme-change', theme: 'dark' }, window.location.origin);
  // ThemeProvider listens and applies
  ```

#### 4. Features Grid
- Title: "A Spreadsheet for Every Team"
- Subtitle: "An open-source alternative to Google Sheets — free to use, extend, and self-host"
- 3×2 grid of feature cards, responsive: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`
  1. Real-Time Collaboration — CRDT-powered concurrent editing
  2. Formula Engine — Google Sheets-compatible (SUM, VLOOKUP, IF, cross-sheet)
  3. Charts & Pivot Tables — data visualization
  4. External Datasources — PostgreSQL, SQL editor
  5. Sharing & Permissions — URL-based, role-based access
  6. Open Source — Apache-2.0, self-host, contribute

#### 5. Developer Section
- Always dark background using explicit Tailwind classes (`bg-stone-900 text-amber-100`) regardless of global theme
- Title: "Built for Developers"
- Two side-by-side code blocks (`grid-cols-1 md:grid-cols-2`):
  - **REST API**: curl examples for read, write, batch update
  - **CLI**: wfb commands for auth, document list, cell read/write, export

#### 6. Open Source Section
- Title: "Join the Open Source Community"
- Three badges: Apache-2.0, TypeScript, Self-Hosted
- "Star on GitHub" button → links to GitHub repository URL

#### 7. Footer
- Single row: "© 2026 Wafflebase" on left
- Right: Docs / API / GitHub links + theme toggle (pill-style)

### Theme System

- **Mechanism**: uses existing class-based Tailwind system (`light`/`dark` on `<html>`)
- **Toggle**: pill-shaped button in footer, toggles between light and dark
- **Initial load**: respects `prefers-color-scheme` (system default)
- **Homepage is outside `PrivateRoute`** so it manages its own theme state with the same `ThemeProvider`

### Implementation: `?theme=` Query Parameter + postMessage Support

The shared document page (`/shared/:token`) currently does not accept external theme overrides. Changes needed in `ThemeProvider`:

1. On mount, check `URLSearchParams` for `theme` parameter
2. If `?theme=light` or `?theme=dark` is present, use it as initial theme (do not write to localStorage)
3. Listen for `postMessage` with `{ type: 'theme-change', theme: 'light' | 'dark' }`:
   ```ts
   useEffect(() => {
     const handler = (e: MessageEvent) => {
       if (e.origin !== window.location.origin) return;
       if (e.data?.type === 'theme-change') setTheme(e.data.theme);
     };
     window.addEventListener('message', handler);
     return () => window.removeEventListener('message', handler);
   }, []);
   ```
4. When theme is externally controlled (query param present), skip localStorage persistence

### Routing

The `/` route must serve different content based on auth state. Approach: create a `HomeOrRedirect` component at the `/` route, **outside** `PrivateRoute`:

```tsx
// App.tsx route changes
<Route path="/" element={<HomeOrRedirect />} />

// HomeOrRedirect component
function HomeOrRedirect() {
  const { user, loading } = useOptionalAuth(); // uses fetchMeOptional()
  if (loading) return <LoadingSpinner />;
  if (user) return <Navigate to={`/w/${user.defaultWorkspaceId}`} replace />;
  return <HomePage />;
}
```

- Move `/` out of the `PrivateRoute` wrapper
- Use `fetchMeOptional()` (already exists in `auth.ts`) to check auth without forcing redirect
- Authenticated → redirect to workspace (existing behavior)
- Unauthenticated → render homepage
- `/login` route remains unchanged

### Accessibility

- All custom colors meet WCAG AA contrast ratio (4.5:1 minimum for body text)
- Navigation bar and footer links are keyboard-navigable
- Semantic HTML: `<nav>`, `<main>`, `<section>`, `<footer>` landmarks
- iframe has descriptive `title` attribute

### File Structure

```
packages/frontend/src/
  app/
    home/
      page.tsx              # Homepage component (composes sections)
      hero-section.tsx       # Hero with title + CTAs
      demo-section.tsx       # iframe live demo with loading/error states
      features-section.tsx   # Feature cards grid
      developer-section.tsx  # API/CLI code examples
      opensource-section.tsx  # Open source CTA
      nav-bar.tsx            # Public navigation bar
      footer.tsx             # Footer with theme toggle
    home-or-redirect.tsx     # Auth-conditional route component
```

### Dependencies

- No new dependencies. Uses existing TailwindCSS + Radix UI + Lucide React

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| iframe blocked by X-Frame-Options / CSP | Same-origin iframe (not cross-origin); add fallback screenshot if blocked |
| iframe loads slowly on first visit | `loading="lazy"`, skeleton placeholder while loading |
| Shared document token expires or data changes | Use a dedicated demo document with stable, read-only content |
| Theme query param not yet supported | Implement ThemeProvider changes before homepage; iframe falls back to system theme |
| `fetchMeOptional()` adds latency to homepage load | Show homepage immediately, check auth in background; redirect only after confirmed |
