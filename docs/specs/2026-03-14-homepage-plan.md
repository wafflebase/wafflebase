# Homepage Landing Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public homepage that introduces Wafflebase to users and developers, with live demo iframe, feature cards, API/CLI examples, and theme support.

**Architecture:** New `home/` page module under `packages/frontend/src/app/` with 6 section components composed by a parent page. A `HomeOrRedirect` component at `/` checks auth optionally and renders homepage or redirects to workspace. ThemeProvider gains `?theme=` query param and `postMessage` support for iframe sync.

**Tech Stack:** React 19, TailwindCSS v4, Lucide React, existing ThemeProvider

**Spec:** `docs/specs/2026-03-14-homepage-design.md`

---

## Chunk 1: Theme Infrastructure

### Task 1: Add homepage CSS variables to index.css

**Files:**
- Modify: `packages/frontend/src/index.css`

- [x] **Step 1: Add homepage variables to `:root`**

Add after the existing `--sidebar-ring` line in `:root` (line 76):

```css
  --homepage-bg: oklch(0.99 0.02 88);
  --homepage-hero-end: oklch(0.96 0.06 88);
  --homepage-text: oklch(0.45 0.12 55);
  --homepage-text-secondary: oklch(0.50 0.13 70);
  --homepage-accent: oklch(0.78 0.18 78);
```

- [x] **Step 2: Add homepage dark overrides**

Add after the existing `--sidebar-ring` line in `.dark` (line 110):

```css
  --homepage-bg: oklch(0.18 0.02 55);
  --homepage-hero-end: oklch(0.22 0.03 70);
  --homepage-text: oklch(0.82 0.15 88);
  --homepage-text-secondary: oklch(0.65 0.15 75);
  --homepage-accent: oklch(0.78 0.18 78);
```

- [x] **Step 3: Register homepage colors in Tailwind theme**

Add inside `@theme inline` block (after line 41):

```css
  --color-homepage-bg: var(--homepage-bg);
  --color-homepage-hero-end: var(--homepage-hero-end);
  --color-homepage-text: var(--homepage-text);
  --color-homepage-text-secondary: var(--homepage-text-secondary);
  --color-homepage-accent: var(--homepage-accent);
```

- [x] **Step 4: Verify the app still builds**

Run: `pnpm frontend build`
Expected: Build succeeds with no errors

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/index.css
git commit -m "Add homepage color tokens to Tailwind theme"
```

### Task 2: Add `?theme=` query param and postMessage to ThemeProvider

**Files:**
- Modify: `packages/frontend/src/components/theme-provider.tsx`

- [x] **Step 1: Add query param detection on mount**

Update the `useState` for `theme` to check URL params first:

```tsx
const [externallyControlled] = useState(() => {
  const params = new URLSearchParams(window.location.search);
  return params.has("theme");
});

const [theme, setThemeState] = useState<Theme>(() => {
  const params = new URLSearchParams(window.location.search);
  const urlTheme = params.get("theme");
  if (urlTheme === "light" || urlTheme === "dark") return urlTheme;
  return (localStorage.getItem(storageKey) as Theme) || defaultTheme;
});
```

- [x] **Step 2: Add postMessage listener**

Add a new `useEffect` after the existing media query listener:

```tsx
useEffect(() => {
  const handler = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === "theme-change") {
      const t = e.data.theme;
      if (t === "light" || t === "dark") {
        setThemeState(t);
      }
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}, []);
```

- [x] **Step 3: Skip localStorage when externally controlled**

Update the `setTheme` in the value object:

```tsx
const value = {
  theme,
  resolvedTheme,
  setTheme: (newTheme: Theme) => {
    if (!externallyControlled) {
      localStorage.setItem(storageKey, newTheme);
    }
    setThemeState(newTheme);
  },
};
```

- [x] **Step 4: Run tests**

Run: `pnpm verify:fast`
Expected: All tests pass

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/components/theme-provider.tsx
git commit -m "Support ?theme= query param and postMessage in ThemeProvider

Allows external control of theme for iframe embedding.
Skips localStorage when theme is set via URL parameter."
```

## Chunk 2: Routing and Auth

### Task 3: Create HomeOrRedirect component and update routing

**Files:**
- Create: `packages/frontend/src/app/home-or-redirect.tsx`
- Modify: `packages/frontend/src/App.tsx`

- [x] **Step 1: Create HomeOrRedirect**

```tsx
// packages/frontend/src/app/home-or-redirect.tsx
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMeOptional } from "@/api/auth";
import { fetchWorkspaces } from "@/api/workspaces";
import { Loader } from "@/components/loader";
import { lazy, Suspense } from "react";

const HomePage = lazy(() => import("@/app/home/page"));

export function HomeOrRedirect() {
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ["me-optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
    enabled: !!user,
  });

  if (userLoading) return <Loader />;

  if (user && workspaces && workspaces.length > 0) {
    return <Navigate to={`/w/${workspaces[0].slug}`} replace />;
  }

  if (user) return <Loader />;

  return (
    <Suspense fallback={<Loader />}>
      <HomePage />
    </Suspense>
  );
}
```

- [x] **Step 2: Update App.tsx routing**

Add the import at the top:

```tsx
import { HomeOrRedirect } from "./app/home-or-redirect";
```

Move the `/` route out of `PrivateRoute`. Change:

```tsx
<Route element={<PrivateRoute />}>
  <Route element={<Layout />}>
    <Route path="/" element={<WorkspaceRedirect />} />
```

To:

```tsx
<Route path="/" element={<HomeOrRedirect />} />
<Route element={<PrivateRoute />}>
  <Route element={<Layout />}>
```

Remove the `WorkspaceRedirect` import if no longer used elsewhere.

- [x] **Step 3: Create placeholder HomePage**

```tsx
// packages/frontend/src/app/home/page.tsx
export default function HomePage() {
  return <div>Homepage placeholder</div>;
}
```

- [x] **Step 4: Verify routing works**

Run: `pnpm verify:fast`
Expected: All tests pass

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/home-or-redirect.tsx \
       packages/frontend/src/app/home/page.tsx \
       packages/frontend/src/App.tsx
git commit -m "Add HomeOrRedirect for auth-conditional homepage

Unauthenticated users see homepage at /.
Authenticated users redirect to their workspace."
```

## Chunk 3: Homepage Sections

### Task 4: NavBar component

**Files:**
- Create: `packages/frontend/src/app/home/nav-bar.tsx`

- [x] **Step 1: Create NavBar**

```tsx
// packages/frontend/src/app/home/nav-bar.tsx
import { Link } from "react-router-dom";
import { Grid2x2PlusIcon } from "lucide-react";

export function NavBar() {
  return (
    <nav className="bg-homepage-bg border-b border-homepage-accent/30 px-12 py-4 flex justify-between items-center">
      <Link to="/" className="flex items-center gap-2 text-xl font-bold text-homepage-text no-underline">
        <Grid2x2PlusIcon className="size-5.5 stroke-homepage-text" />
        Wafflebase
      </Link>
      <div className="flex items-center gap-6">
        <a href="#features" className="text-sm text-homepage-text-secondary no-underline">Features</a>
        <a href="#developers" className="text-sm text-homepage-text-secondary no-underline">Developers</a>
        <Link to="/login" className="bg-homepage-accent text-white px-5 py-2 rounded-md text-sm font-semibold no-underline">
          Get Started
        </Link>
      </div>
    </nav>
  );
}
```

- [x] **Step 2: Commit**

```bash
git add packages/frontend/src/app/home/nav-bar.tsx
git commit -m "Add homepage NavBar component"
```

### Task 5: HeroSection component

**Files:**
- Create: `packages/frontend/src/app/home/hero-section.tsx`

- [x] **Step 1: Create HeroSection**

```tsx
// packages/frontend/src/app/home/hero-section.tsx
import { Link } from "react-router-dom";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

export function HeroSection() {
  return (
    <section className="bg-gradient-to-b from-homepage-bg to-homepage-hero-end py-20 px-12 text-center">
      <h1 className="text-5xl font-extrabold text-homepage-text mb-4 leading-tight">
        Super Simple Spreadsheet
        <br />
        for Data Analysis
      </h1>
      <p className="text-xl text-homepage-text-secondary mb-8 max-w-xl mx-auto">
        A collaborative, open-source spreadsheet with real-time editing,
        formulas, charts, and a powerful REST API &amp; CLI for automation.
      </p>
      <div className="flex gap-3 justify-center">
        <Link
          to="/login"
          className="bg-homepage-accent text-white px-8 py-3.5 rounded-lg text-base font-semibold no-underline"
        >
          Get Started Free →
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="border-2 border-homepage-accent text-homepage-text px-8 py-3.5 rounded-lg text-base font-semibold no-underline"
        >
          View on GitHub →
        </a>
      </div>
    </section>
  );
}
```

- [x] **Step 2: Commit**

```bash
git add packages/frontend/src/app/home/hero-section.tsx
git commit -m "Add homepage HeroSection component"
```

### Task 6: DemoSection component (iframe)

**Files:**
- Create: `packages/frontend/src/app/home/demo-section.tsx`

- [x] **Step 1: Create DemoSection**

```tsx
// packages/frontend/src/app/home/demo-section.tsx
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme-provider";

const DEMO_TOKEN = "bed3dbe8-bdce-46ef-a76e-65fd67178cde";

export function DemoSection() {
  const { resolvedTheme } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const prevThemeRef = useRef(resolvedTheme);

  const [error, setError] = useState(false);
  const demoUrl = `${window.location.origin}/shared/${DEMO_TOKEN}?theme=${resolvedTheme}`;

  // Sync iframe theme via postMessage when theme changes after initial load
  useEffect(() => {
    if (!loaded || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: "theme-change", theme: resolvedTheme },
      window.location.origin,
    );
  }, [resolvedTheme, loaded]);

  return (
    <section className="bg-homepage-bg px-12 pb-15 text-center">
      <div className="max-w-[960px] mx-auto rounded-xl border border-border shadow-xl overflow-hidden">
        <div className="bg-muted px-4 py-2.5 flex gap-1.5 items-center border-b border-border">
          <div className="size-2.5 rounded-full bg-[#FF5F57]" />
          <div className="size-2.5 rounded-full bg-[#FEBC2E]" />
          <div className="size-2.5 rounded-full bg-[#28C840]" />
        </div>
        <div className="w-full aspect-video relative">
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <div className="text-muted-foreground text-sm">Loading demo...</div>
            </div>
          )}
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <img
                src="/images/screenshot-demo.png"
                alt="Wafflebase spreadsheet"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={demoUrl}
              title="Wafflebase live demo spreadsheet"
              className="w-full h-full border-0"
              loading="lazy"
              allow="clipboard-read; clipboard-write"
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
            />
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground mt-4 italic">
        Try it live — this is a real Wafflebase spreadsheet
      </p>
    </section>
  );
}
```

- [x] **Step 2: Commit**

```bash
git add packages/frontend/src/app/home/demo-section.tsx
git commit -m "Add homepage DemoSection with live iframe

Syncs theme via postMessage after initial load.
Shows loading skeleton while iframe loads."
```

### Task 7: FeaturesSection component

**Files:**
- Create: `packages/frontend/src/app/home/features-section.tsx`

- [x] **Step 1: Create FeaturesSection**

```tsx
// packages/frontend/src/app/home/features-section.tsx

const features = [
  {
    icon: "⚡",
    title: "Real-Time Collaboration",
    description: "CRDT-powered concurrent editing. Multiple users can work on the same sheet without conflicts.",
  },
  {
    icon: "📐",
    title: "Formula Engine",
    description: "Google Sheets-compatible formulas — SUM, VLOOKUP, IF, and more. Cross-sheet references supported.",
  },
  {
    icon: "📊",
    title: "Charts & Pivot Tables",
    description: "Visualize your data with built-in charts and pivot tables. Get insights at a glance.",
  },
  {
    icon: "🔗",
    title: "External Datasources",
    description: "Connect PostgreSQL databases directly. Query live data with the built-in SQL editor.",
  },
  {
    icon: "🔒",
    title: "Sharing & Permissions",
    description: "Share via URL with role-based access control. Collaborate with anyone, securely.",
  },
  {
    icon: "🧇",
    title: "Open Source",
    description: "Apache-2.0 licensed. Self-host, customize, and contribute. Your data, your rules.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="bg-background py-20 px-12">
      <h2 className="text-center text-3xl font-bold text-homepage-text mb-2">
        A Spreadsheet for Every Team
      </h2>
      <p className="text-center text-base text-homepage-text-secondary mb-12">
        An open-source alternative to Google Sheets — free to use, extend, and self-host
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-[960px] mx-auto">
        {features.map((f) => (
          <div key={f.title} className="bg-homepage-bg border border-homepage-accent/30 rounded-xl p-7">
            <div className="text-3xl mb-3">{f.icon}</div>
            <h3 className="text-lg font-semibold text-homepage-text mb-2">{f.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [x] **Step 2: Commit**

```bash
git add packages/frontend/src/app/home/features-section.tsx
git commit -m "Add homepage FeaturesSection component"
```

### Task 8: DeveloperSection component

**Files:**
- Create: `packages/frontend/src/app/home/developer-section.tsx`

- [x] **Step 1: Create DeveloperSection**

```tsx
// packages/frontend/src/app/home/developer-section.tsx

const restApiCode = `# Read a cell
curl /api/v1/workspaces/:wid/\\
  documents/:did/tabs/:tid/\\
  cells/A1 \\
  -H "Authorization: Bearer wfb_..."

# Write a cell
curl -X PUT /api/v1/.../cells/B2 \\
  -d '{"value": "Hello"}'

# Batch update
curl -X PATCH /api/v1/.../cells \\
  -d '{"cells": {"A1": {"value": "1"},
    "B1": {"formula": "=A1*2"}}}'`;

const cliCode = `# Authenticate
$ wfb auth login

# List documents
$ wfb document list
[
  {"id": "abc-123",
   "title": "Q1 Report"}
]

# Read / write cells
$ wfb cell get abc-123 Sheet1 A1
$ wfb cell set abc-123 Sheet1 B2 \\
    --value "Hello"

# Export to CSV
$ wfb export abc-123 -o data.csv`;

export function DeveloperSection() {
  return (
    <section id="developers" className="bg-stone-900 py-20 px-12">
      <h2 className="text-center text-3xl font-bold text-amber-300 mb-2">
        Built for Developers
      </h2>
      <p className="text-center text-base text-amber-600 mb-12">
        Automate your spreadsheets with REST API and CLI
      </p>
      <div className="max-w-[900px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-stone-800 rounded-xl p-6 overflow-x-auto">
          <div className="text-xs text-stone-400 font-semibold uppercase tracking-wider mb-3">
            REST API
          </div>
          <pre className="text-amber-50 text-sm font-mono leading-7 whitespace-pre">
            {restApiCode}
          </pre>
        </div>
        <div className="bg-stone-800 rounded-xl p-6 overflow-x-auto">
          <div className="text-xs text-stone-400 font-semibold uppercase tracking-wider mb-3">
            CLI
          </div>
          <pre className="text-amber-50 text-sm font-mono leading-7 whitespace-pre">
            {cliCode}
          </pre>
        </div>
      </div>
    </section>
  );
}
```

- [x] **Step 2: Commit**

```bash
git add packages/frontend/src/app/home/developer-section.tsx
git commit -m "Add homepage DeveloperSection component"
```

### Task 9: OpenSourceSection component

**Files:**
- Create: `packages/frontend/src/app/home/opensource-section.tsx`

- [x] **Step 1: Create OpenSourceSection**

```tsx
// packages/frontend/src/app/home/opensource-section.tsx

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

const badges = ["Apache-2.0", "TypeScript", "Self-Hosted"];

export function OpenSourceSection() {
  return (
    <section className="bg-homepage-hero-end py-20 px-12 text-center">
      <h2 className="text-3xl font-bold text-homepage-text mb-3">
        Join the Open Source Community
      </h2>
      <p className="text-base text-homepage-text-secondary mb-8 max-w-lg mx-auto">
        Wafflebase is open-source under the Apache-2.0 license. Contributions
        are welcome from everyone.
      </p>
      <div className="flex gap-4 justify-center mb-6">
        {badges.map((b) => (
          <span
            key={b}
            className="bg-homepage-bg border border-homepage-accent/30 rounded-lg px-6 py-3 text-sm text-homepage-text font-semibold"
          >
            {b}
          </span>
        ))}
      </div>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 bg-stone-900 dark:bg-amber-400 text-white dark:text-stone-900 px-8 py-3.5 rounded-lg text-base font-semibold no-underline"
      >
        ⭐ Star on GitHub
      </a>
    </section>
  );
}
```

- [x] **Step 2: Commit**

```bash
git add packages/frontend/src/app/home/opensource-section.tsx
git commit -m "Add homepage OpenSourceSection component"
```

### Task 10: Footer component with theme toggle

**Files:**
- Create: `packages/frontend/src/app/home/footer.tsx`

- [x] **Step 1: Create Footer**

```tsx
// packages/frontend/src/app/home/footer.tsx
import { useTheme } from "@/components/theme-provider";

export function Footer() {
  const { resolvedTheme, setTheme } = useTheme();

  function toggleTheme() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  return (
    <footer className="bg-stone-900 px-12 py-6">
      <div className="max-w-[960px] mx-auto flex justify-between items-center">
        <span className="text-stone-500 text-xs">© 2026 Wafflebase</span>
        <div className="flex items-center gap-5">
          <a href="https://github.com/wafflebase/wafflebase" target="_blank" rel="noopener noreferrer" className="text-stone-400 text-sm no-underline">Docs</a>
          <a href="https://github.com/wafflebase/wafflebase" target="_blank" rel="noopener noreferrer" className="text-stone-400 text-sm no-underline">API</a>
          <a href="https://github.com/wafflebase/wafflebase" target="_blank" rel="noopener noreferrer" className="text-stone-400 text-sm no-underline">GitHub</a>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="relative bg-stone-800 border-0 rounded-full w-11 h-6 cursor-pointer"
          >
            <div
              className={`absolute top-0.75 left-0.75 size-4.5 rounded-full bg-amber-400 transition-transform flex items-center justify-center text-[10px] ${
                resolvedTheme === "dark" ? "translate-x-5" : ""
              }`}
            >
              {resolvedTheme === "dark" ? "🌙" : "☀️"}
            </div>
          </button>
        </div>
      </div>
    </footer>
  );
}
```

- [x] **Step 2: Commit**

```bash
git add packages/frontend/src/app/home/footer.tsx
git commit -m "Add homepage Footer with theme toggle"
```

## Chunk 4: Compose and Verify

### Task 11: Compose all sections in HomePage

**Files:**
- Modify: `packages/frontend/src/app/home/page.tsx`

- [x] **Step 1: Update page.tsx to compose all sections**

```tsx
// packages/frontend/src/app/home/page.tsx
import { NavBar } from "./nav-bar";
import { HeroSection } from "./hero-section";
import { DemoSection } from "./demo-section";
import { FeaturesSection } from "./features-section";
import { DeveloperSection } from "./developer-section";
import { OpenSourceSection } from "./opensource-section";
import { Footer } from "./footer";

export default function HomePage() {
  return (
    <main className="scroll-smooth">
      <NavBar />
      <HeroSection />
      <DemoSection />
      <FeaturesSection />
      <DeveloperSection />
      <OpenSourceSection />
      <Footer />
    </main>
  );
}
```

- [x] **Step 2: Run full verification**

Run: `pnpm verify:fast`
Expected: All lint and tests pass

- [x] **Step 3: Manual test**

Run: `pnpm dev`
- Visit `http://localhost:5173/` while logged out → should see homepage
- Visit `http://localhost:5173/` while logged in → should redirect to workspace
- Toggle theme in footer → page and iframe theme should sync
- Click "Get Started" → should go to `/login`
- Click anchor links (Features, Developers) → should smooth scroll

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/home/page.tsx
git commit -m "Compose homepage from section components

Assembles NavBar, Hero, Demo, Features, Developer,
OpenSource, and Footer sections into the landing page."
```

### Task 12: Final cleanup and verify

- [x] **Step 1: Run full verification**

Run: `pnpm verify:fast`
Expected: All pass

- [x] **Step 2: Visual check in both themes**

Verify in browser:
- Light mode: warm amber/gold tones, readable contrast
- Dark mode: dark backgrounds, amber text, iframe theme matches
- Responsive: resize window to check grid breakpoints

- [x] **Step 3: Final commit if any adjustments needed**
