# Homepage Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the Wafflebase homepage with unified messaging, hierarchical features, mobile nav, expanded footer, and a "Why Wafflebase" section.

**Architecture:** All changes are in `packages/frontend/src/app/home/`. Each section is its own component file. New sections are added as new component files and wired into `page.tsx`. No backend changes, no new dependencies — only lucide-react icons already available.

**Tech Stack:** React, Tailwind CSS v4, lucide-react, React Router

---

## Chunk 1: Messaging & Structure

### Task 1: Unify target messaging — Hero + Features

**Files:**
- Modify: `packages/frontend/src/app/home/hero-section.tsx`
- Modify: `packages/frontend/src/app/home/features-section.tsx`

The current hero says "for Data Analysis" while features say "for Every Team". Unify around a developer-and-team-focused message: **"The Open-Source Spreadsheet You Can Own"** — emphasizing self-hosting, API access, and real-time collaboration as the core value prop.

- [x] **Step 1: Update hero headline and description**

In `hero-section.tsx`, replace the headline and description:

```tsx
<h1 className="text-3xl md:text-5xl font-extrabold text-homepage-text mb-4 leading-tight">
  The Open-Source Spreadsheet
  <br />
  You Can Own
</h1>
<p className="text-base md:text-xl text-homepage-text-secondary mb-8 max-w-xl mx-auto">
  Self-host a collaborative spreadsheet with real-time editing,
  Google Sheets-compatible formulas, and a REST API for automation.
</p>
```

- [x] **Step 2: Update features section headline**

In `features-section.tsx`, change the section title and subtitle to align:

```tsx
<h2 className="text-center text-3xl font-bold text-homepage-text mb-2">
  Everything You Need, Nothing You Don't
</h2>
<p className="text-center text-base text-homepage-text-secondary mb-12">
  Built for teams and developers who want full control over their data
</p>
```

- [x] **Step 3: Verify visually**

Run: `pnpm dev` and check `/` — hero and features messaging should feel cohesive.

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/home/hero-section.tsx packages/frontend/src/app/home/features-section.tsx
git commit -m "Unify homepage messaging around ownership and control"
```

---

### Task 2: Hierarchize Features section — highlight top 3 differentiators

**Files:**
- Modify: `packages/frontend/src/app/home/features-section.tsx`

Split features into two tiers: 3 hero features (large cards with icons) and 3 secondary features (compact row). The hero features are: Real-Time Collaboration, REST API & CLI, Open Source / Self-Hosted.

- [x] **Step 1: Restructure features into two tiers**

Replace the entire `features-section.tsx` with a two-tier layout:

```tsx
import { Globe, Terminal, Server, FunctionSquare, BarChart3, Shield } from "lucide-react";
import type { ReactNode } from "react";

const heroFeatures: { icon: ReactNode; title: string; description: string }[] = [
  {
    icon: <Globe className="size-8 text-homepage-accent" />,
    title: "Real-Time Collaboration",
    description:
      "CRDT-powered concurrent editing — multiple users work on the same sheet without conflicts or data loss.",
  },
  {
    icon: <Terminal className="size-8 text-homepage-accent" />,
    title: "REST API & CLI",
    description:
      "Read and write cells programmatically. Automate reports, sync data pipelines, or build integrations.",
  },
  {
    icon: <Server className="size-8 text-homepage-accent" />,
    title: "Self-Hosted & Open Source",
    description:
      "Apache-2.0 licensed. Deploy on your infrastructure, keep full control of your data, customize freely.",
  },
];

const secondaryFeatures: { icon: ReactNode; title: string; description: string }[] = [
  {
    icon: <FunctionSquare className="size-5 text-homepage-accent" />,
    title: "Google Sheets-Compatible Formulas",
    description: "SUM, VLOOKUP, IF, and cross-sheet references",
  },
  {
    icon: <BarChart3 className="size-5 text-homepage-accent" />,
    title: "Charts & Pivot Tables",
    description: "Built-in data visualization and aggregation",
  },
  {
    icon: <Shield className="size-5 text-homepage-accent" />,
    title: "Sharing & Permissions",
    description: "URL sharing with role-based access control",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="bg-background py-12 md:py-20 px-4 md:px-12">
      <h2 className="text-center text-3xl font-bold text-homepage-text mb-2">
        Everything You Need, Nothing You Don't
      </h2>
      <p className="text-center text-base text-homepage-text-secondary mb-12">
        Built for teams and developers who want full control over their data
      </p>

      {/* Hero features — large cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-[960px] mx-auto mb-8">
        {heroFeatures.map((f) => (
          <div
            key={f.title}
            className="bg-homepage-bg border border-homepage-accent/30 rounded-xl p-8"
          >
            <div className="mb-4">{f.icon}</div>
            <h3 className="text-lg font-semibold text-homepage-text mb-2">{f.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>

      {/* Secondary features — compact row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-[960px] mx-auto">
        {secondaryFeatures.map((f) => (
          <div
            key={f.title}
            className="flex items-start gap-3 rounded-lg px-5 py-4"
          >
            <div className="mt-0.5 shrink-0">{f.icon}</div>
            <div>
              <h3 className="text-sm font-semibold text-homepage-text">{f.title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [x] **Step 2: Verify visually**

Run: `pnpm dev` — check that hero features are prominent and secondary features feel supportive.

- [x] **Step 3: Commit**

```bash
git add packages/frontend/src/app/home/features-section.tsx
git commit -m "Hierarchize features section with primary and secondary tiers"
```

---

### Task 3: Add "Why Wafflebase" comparison section

**Files:**
- Create: `packages/frontend/src/app/home/why-section.tsx`
- Modify: `packages/frontend/src/app/home/page.tsx`

Add a section between Hero+Demo and Features that positions Wafflebase against Google Sheets / Airtable with a comparison table.

- [x] **Step 1: Create why-section.tsx**

```tsx
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

const rows: { label: string; wafflebase: ReactNode; others: ReactNode }[] = [
  {
    label: "Self-hosted",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <X className="size-4 text-muted-foreground" />,
  },
  {
    label: "Own your data",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <X className="size-4 text-muted-foreground" />,
  },
  {
    label: "REST API & CLI",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <span className="text-xs text-muted-foreground">Limited</span>,
  },
  {
    label: "Real-time collaboration",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <Check className="size-4 text-green-500" />,
  },
  {
    label: "Open source (Apache-2.0)",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <X className="size-4 text-muted-foreground" />,
  },
  {
    label: "Free forever",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <span className="text-xs text-muted-foreground">Freemium</span>,
  },
];

export function WhySection() {
  return (
    <section className="bg-homepage-bg py-12 md:py-20 px-4 md:px-12">
      <h2 className="text-center text-3xl font-bold text-homepage-text mb-2">
        Why Wafflebase?
      </h2>
      <p className="text-center text-base text-homepage-text-secondary mb-10 max-w-lg mx-auto">
        A spreadsheet that respects your data and your workflow
      </p>

      <div className="max-w-[540px] mx-auto rounded-xl border border-homepage-accent/30 overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-3 text-sm font-semibold bg-homepage-hero-end">
          <div className="px-5 py-3 text-homepage-text-secondary" />
          <div className="px-5 py-3 text-center text-homepage-text">Wafflebase</div>
          <div className="px-5 py-3 text-center text-muted-foreground">Others</div>
        </div>
        {/* Rows */}
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`grid grid-cols-3 text-sm ${
              i % 2 === 0 ? "bg-homepage-bg" : "bg-homepage-hero-end/50"
            }`}
          >
            <div className="px-5 py-3 text-homepage-text">{row.label}</div>
            <div className="px-5 py-3 flex justify-center">{row.wafflebase}</div>
            <div className="px-5 py-3 flex justify-center">{row.others}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [x] **Step 2: Wire into page.tsx**

In `packages/frontend/src/app/home/page.tsx`, add the import and place `<WhySection />` after `<DemoSection />`:

```tsx
import { WhySection } from "./why-section";
// ...
<DemoSection />
<WhySection />
<FeaturesSection />
```

- [x] **Step 3: Verify visually**

Run: `pnpm dev` — the comparison table should appear between Demo and Features.

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/home/why-section.tsx packages/frontend/src/app/home/page.tsx
git commit -m "Add 'Why Wafflebase' comparison section to homepage"
```

---

## Chunk 2: Navigation & Footer

### Task 4: Add mobile hamburger navigation

**Files:**
- Modify: `packages/frontend/src/app/home/nav-bar.tsx`

Add a hamburger menu for mobile that shows Features, Docs, and CTA links. Use React state for open/close — no new dependencies.

- [x] **Step 1: Add mobile menu to nav-bar.tsx**

Replace `nav-bar.tsx` with:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { Grid2x2PlusIcon, Menu, X } from "lucide-react";

export function NavBar({ workspacePath }: { workspacePath: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="bg-homepage-bg border-b border-homepage-accent/30 px-4 md:px-12 py-4">
      <div className="flex justify-between items-center">
        <Link
          to="/"
          className="flex items-center gap-2 text-xl font-bold text-homepage-text no-underline"
        >
          <Grid2x2PlusIcon className="size-5.5 stroke-homepage-text" />
          Wafflebase
        </Link>
        <div className="flex items-center gap-6">
          {/* Desktop links */}
          <a
            href="#features"
            className="hidden md:inline text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            Features
          </a>
          <a
            href="/docs"
            className="hidden md:inline text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            Docs
          </a>
          <a
            href="https://github.com/wafflebase/wafflebase"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            GitHub
          </a>
          <Link
            to={workspacePath ?? "/login"}
            className="hidden md:inline-block bg-homepage-accent text-white px-5 py-2 rounded-md text-sm font-semibold no-underline"
          >
            {workspacePath ? "Go to Workspace" : "Get Started"}
          </Link>
          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-1 text-homepage-text"
            aria-label="Toggle menu"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden mt-4 pb-2 flex flex-col gap-3 border-t border-homepage-accent/20 pt-4">
          <a
            href="#features"
            onClick={() => setOpen(false)}
            className="text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            Features
          </a>
          <a
            href="/docs"
            className="text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            Docs
          </a>
          <a
            href="https://github.com/wafflebase/wafflebase"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            GitHub
          </a>
          <Link
            to={workspacePath ?? "/login"}
            onClick={() => setOpen(false)}
            className="bg-homepage-accent text-white px-5 py-2 rounded-md text-sm font-semibold no-underline text-center"
          >
            {workspacePath ? "Go to Workspace" : "Get Started"}
          </Link>
        </div>
      )}
    </nav>
  );
}
```

- [x] **Step 2: Verify on mobile viewport**

Run: `pnpm dev`, open browser DevTools, toggle to mobile viewport — hamburger should appear and expand/collapse.

- [x] **Step 3: Commit**

```bash
git add packages/frontend/src/app/home/nav-bar.tsx
git commit -m "Add mobile hamburger menu to homepage navbar"
```

---

### Task 5: Expand Footer with multi-column layout

**Files:**
- Modify: `packages/frontend/src/app/home/footer.tsx`

Replace the minimal footer with a 3-column layout (Product, Community, Project) plus bottom bar with copyright and theme toggle.

- [x] **Step 1: Replace footer.tsx**

```tsx
import { useTheme } from "@/components/theme-provider";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Documentation", href: "/docs" },
      { label: "REST API", href: "/docs/api/rest-api" },
      { label: "CLI", href: "/docs/api/cli" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: GITHUB_URL, external: true },
      { label: "Issues", href: `${GITHUB_URL}/issues`, external: true },
      { label: "Discussions", href: `${GITHUB_URL}/discussions`, external: true },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "License (Apache-2.0)", href: `${GITHUB_URL}/blob/main/LICENSE`, external: true },
      { label: "Changelog", href: `${GITHUB_URL}/releases`, external: true },
      { label: "Contributing", href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md`, external: true },
    ],
  },
] as const;

export function Footer() {
  const { resolvedTheme, setTheme } = useTheme();

  function toggleTheme() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  return (
    <footer className="bg-homepage-dark-bg px-4 md:px-12 pt-12 pb-6">
      <div className="max-w-[960px] mx-auto">
        {/* Column links */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mb-10">
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-homepage-dark-text mb-3">
                {col.title}
              </h4>
              <ul className="space-y-2 list-none p-0 m-0">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...("external" in link && link.external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="text-sm text-homepage-dark-muted no-underline hover:text-homepage-dark-link"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-homepage-dark-card pt-6 flex justify-between items-center">
          <span className="text-homepage-dark-muted text-xs">
            © {new Date().getFullYear()} Wafflebase
          </span>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="relative bg-homepage-dark-card border-0 rounded-full w-11 h-6 cursor-pointer"
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

- [x] **Step 2: Verify visually**

Run: `pnpm dev` — footer should show 3 columns on desktop, 2 columns on mobile, with a bottom bar.

- [x] **Step 3: Commit**

```bash
git add packages/frontend/src/app/home/footer.tsx
git commit -m "Expand homepage footer with multi-column layout"
```

---

## Verification

After all tasks:

- [x] Run `pnpm verify:fast` — must pass
- [x] Check desktop viewport: all sections flow logically (Hero → Demo → Why → Features → Developer → OSS → Footer)
- [x] Check mobile viewport: hamburger menu works, sections stack properly, footer collapses to 2 columns
- [x] Check dark mode: all new sections respect theme variables
