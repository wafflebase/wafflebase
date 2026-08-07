---
title: design-editor-audit
target-version: 0.6.2
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# WaffleBase — Design System Audit & Automation Report

> **Why this is filed under `design-editor/`.** This July-2026 audit is the
> evidence base for the editor's support matrix: it establishes that wafflebase's
> own frontend is a **shadcn/ui + Radix + Tailwind v4 + CVA** codebase with a
> single-source token layer, which is the convention set
> [`design-editor-local-plugin.md`](./design-editor-local-plugin.md) §3 targets.
> Its "gaps" section (hand-authored TS tokens, no DTCG interchange, no CI token
> lint) is also the argument for the `TokenAdapter` seam — wafflebase's own token
> pipeline is the *hard* case, not the representative one.

**Author:** Design System Lead / Code Auditor pass
**Date:** 2026-07-24
**Scope:** `Button`, `Popover`, `Dropdown` primitives + the token layer feeding them
**Repos/paths audited:** `packages/frontend/src/components/ui/`, `packages/frontend/src/index.css`, `packages/core/src/tokens/`, `docs/design/**/*.md`

---

## 0. Executive Summary

WaffleBase already runs a **mature, single-source token layer** (shadcn/ui on
Radix + Tailwind v4 + CVA, fed by `@wafflebase/core/tokens`). The three audited
primitives — **Button, Popover, Dropdown** — are **fully token-compliant**: zero
hardcoded colors, zero hex, consistent CVA-based prop APIs. This is an unusually
clean starting point.

The gaps that block a **Figma → GitHub → code** automated workflow are **not** in
the audited components; they are structural:

1. Tokens are hand-authored **TypeScript**, not a design-tool-interchangeable
   format (DTCG JSON). This is the single biggest blocker to a Figma round-trip.
2. Only **color / radius / typography** are tokenized. **Spacing/sizing is not** —
   162 arbitrary `[Npx]` values live in app-level code, and the semantic layer is
   missing a few roles (a strong divider, file-type accents, a type scale), which
   is *exactly* what forces the handful of hardcoded-color escapes that do exist.
3. There is **no component catalog** (Storybook/showcase) and **no CI token-lint
   gate** — so compliance today is a convention, not an enforced contract.

Feasibility verdict: **HIGH** for a token-pipeline SSOT (Tokens Studio + Style
Dictionary), **MEDIUM** for full Figma-Merge tooling (needs a catalog first). A
Node AST extractor (delivered in Mission 2, `scripts/extract-design-metadata.mjs`)
is the connective tissue and is already working.

---

## Mission 1 — Design Token & Consistency Audit

### 1.0 How the token system is wired (context)

```text
packages/core/src/tokens/           →  build-css.ts  →  @wafflebase/core/tokens.css
  palette.ts    raw oklch (Butter & Maple brand + neutrals)          │
  semantic.ts   light/dark role maps (primary, popover, border, …)   │  (CSS custom props)
  radius.ts     0.3rem base + sm/md/lg/xl                             ▼
  typography.ts display / body / code font stacks          packages/frontend/src/index.css
                                                              @import "@wafflebase/core/tokens.css";
                                                              @theme inline { --color-primary: var(--primary); … }
                                                                       ▼
                                                            Tailwind utilities: bg-primary, text-popover-foreground, …
```

The `@theme inline` block in `index.css` maps every CSS variable to a Tailwind
color utility, so **the correct, on-token way to style is a semantic utility class**
(`bg-primary`, `border`, `bg-popover`, `text-muted-foreground`). Any raw palette
class (`bg-zinc-300`), hex, or `rgb()` bypasses that layer.

### 1.1 Token compliance of Button / Popover / Dropdown — ✅ PASS

Verified by static extraction (`scripts/extract-design-metadata.mjs`) and manual read.

| Component | Tokens referenced | Hardcoded color | Hex/rgb | Verdict |
|-----------|-------------------|-----------------|---------|---------|
| **Button** (`button.tsx`) | `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `accent`, `accent-foreground`, `destructive`, `background`, `input`, `ring` | none | none | ✅ Clean |
| **Popover** (`popover.tsx`) | `popover`, `popover-foreground`, `border` (implied), `ring` | none | none | ✅ Clean |
| **Dropdown** (`dropdown-menu.tsx`) | `popover`, `popover-foreground`, `accent`, `accent-foreground`, `destructive`, `muted-foreground`, `border` | none | none | ✅ Clean |

All three consume the semantic layer exclusively. Radius comes from
`rounded-md`/`rounded-sm` (token-mapped). Typography via `text-sm`/`text-xs`
(Tailwind scale). Motion via `tw-animate-css` data-state variants — consistent
across Popover, Dropdown, and its SubContent.

**One benign flag:** `button.tsx` uses `focus-visible:ring-[3px]` — an arbitrary
value, but it is a focus-ring *width*, not a color, and is intentional. Recorded,
not blocking.

### 1.2 Anti-patterns in the codebase

The audited trio is clean, but the wider frontend has escapes. Measured counts:

| Anti-pattern | Count | Where | Assessment |
|--------------|-------|-------|------------|
| Hardcoded Tailwind palette colors (`bg-zinc-300`, `text-blue-500`, …) | **43 across 11 files** | `document-list.tsx` (19), `pdf-comment-layer.tsx` (11), `docs-link-popover.tsx` (4), **`ui/toolbar.tsx` (2)**, misc (7) | Mixed — see below |
| Arbitrary pixel values `-[Npx]` | **162** | mostly `app/home/*` (marketing) + some editor chrome | Spacing/sizing not tokenized |
| Hex literals in a component | **~60** | `components/formatting-colors.ts` | **Legitimate swatch data**, not styling — already scheduled as PR #2 |

**The one that matters inside `ui/`:**

```tsx
// packages/frontend/src/components/ui/toolbar.tsx  (ToolbarSeparator)
className={cn("mx-2 !h-5 bg-zinc-300 dark:bg-zinc-700", className)}
//                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^ hardcoded, bypasses --border
```

This is instructive: the in-code comment says `bg-border` (`--border` at oklch 0.92)
"is too faint to read as a divider." So the developer *wanted* a token, none
existed for "a divider with more contrast than a hairline border," and fell back to
`zinc`. **The anti-pattern is a symptom of a missing semantic token**
(`--separator` / `border-strong`), not carelessness.

**Defensible (but tokenizable) escapes:**

- `document-list.tsx` — file-type icon colors (`text-green-600` = Sheet,
  `text-blue-500` = Doc, `text-purple-500` = Note, `text-orange-500` = Slides,
  `text-red-500` = PDF, `text-pink-500` = Image). Semantic *by document type* but
  not on the token layer → should become `--doc-accent-{sheet,doc,note,…}`.
- `docs-link-popover.tsx` — `text-blue-{600,800,400,300}` for hyperlink text +
  `fixed` positioning. This is the **custom, non-Radix popover** the design doc
  flags for migration (PR #6, "Floating UI consolidation"). Two problems in one file.

### 1.3 Props-interface naming consistency — ✅ largely consistent, 1 real clash

The primitives follow shadcn/CVA conventions uniformly:

| Convention | Button | Popover | Dropdown | Toolbar | Verdict |
|------------|--------|---------|----------|---------|---------|
| CVA + `VariantProps<typeof xVariants>` | ✓ `buttonVariants` | n/a (no variants) | n/a | ✓ `toolbarButtonVariants` | consistent |
| `variant` axis name | ✓ | — | ✓ (`DropdownMenuItem`) | ✓ | consistent |
| `size` axis name | ✓ | — | — | — | consistent where present |
| `asChild` (Slot) | ✓ | (Radix) | (Radix) | — | consistent |
| `inset` boolean | — | — | ✓ | — | consistent (Radix-menu idiom) |
| Radix passthrough (`align`, `sideOffset`) | — | ✓ | ✓ | — | consistent |

**The one genuine inconsistency to fix:** `"icon"` is a **`size`** in `Button`
(`size: { icon: "size-9" }`) but a **`variant`** in `ToolbarButton`
(`variant: { icon, menu }`). Same word, different axis — a cognitive trap for
anyone composing buttons. Recommend renaming `ToolbarButton`'s axis to `shape` or
`kind`, or aligning it to `size`.

Secondary note: `variant` *value sets* differ per component (Button has 6, menu
items have 2). That is expected and correct — the **axis names** are what must be
consistent, and they are.

### Mission 1 scorecard

| Area | Grade | Note |
|------|-------|------|
| Audited primitives → tokens | **A** | Fully compliant |
| Prop naming consistency | **A−** | One `icon` size-vs-variant clash |
| Wider codebase color hygiene | **B−** | 43 palette escapes, most tokenizable |
| Spacing/sizing tokenization | **C** | 162 arbitrary px; no spacing token layer |
| Semantic-layer completeness | **B−** | Missing separator / doc-accent / type-scale roles |

---

## Mission 2 — Component Auto-Extraction Pipeline

### 2.1 Methodology

Deliverable: **`scripts/extract-design-metadata.mjs`** — a self-contained Node
script that statically analyzes the components with the **TypeScript compiler API**
(`typescript@5.9.3`, already a workspace dep — **no new dependencies**, no Babel,
no ts-morph). Chosen over regex because CVA configs and props intersections
(`React.ComponentProps<"button"> & VariantProps<…> & { asChild?: boolean }`) are
structured AST, not line-oriented text.

**What it extracts, per component:**

1. **Component identity** — name + `kind` (`function` vs `forwardRef`) + the Radix
   primitive it wraps (from the props type reference).
2. **Props** — name, TypeScript type text, optional flag, and **origin**
   (`explicit` object member vs `native:React.ComponentProps<…>` vs
   `variant-props:VariantProps<…>`). This separates the component's *own* API from
   inherited DOM/Radix props.
3. **CVA variant axes** — base class string, every variant axis → its value list,
   and `defaultVariants` (this is the real, enforceable component API surface).
4. **Design tokens used** — every semantic Tailwind utility
   (`bg-primary`, `text-popover-foreground`, …) resolved against the token
   vocabulary, folded across both the function body **and** the CVA class strings.
5. **Anti-patterns** — hardcoded palette classes, hex literals, `rgb()/hsl()`
   literals, and arbitrary `-[Npx]` values.
6. **Roll-up summary** — component count, union of tokens used, anti-pattern totals.

### 2.2 JSON output (verified real output, abridged)

```jsonc
{
  "generatedBy": "scripts/extract-design-metadata.mjs",
  "tokenVocabulary": { "semanticRoles": ["background", "primary", "popover", ...] },
  "files": [
    {
      "file": ".../components/ui/button.tsx",
      "module": "button",
      "components": [
        {
          "name": "Button",
          "kind": "function",
          "props": [
            { "name": "asChild", "type": "boolean", "optional": true, "origin": "explicit" }
          ],
          "propOrigins": [
            "native:React.ComponentProps<\"button\">",
            "variant-props:VariantProps<typeof buttonVariants>"
          ],
          "tokensUsed": [
            "accent", "accent-foreground", "background", "destructive", "input",
            "primary", "primary-foreground", "ring", "secondary", "secondary-foreground"
          ],
          "antiPatterns": {
            "hardcodedPaletteColors": [], "hexLiterals": [],
            "rgbHslLiterals": [], "arbitraryPx": ["ring-[3px]"]
          },
          "variants": {
            "variants": {
              "variant": ["default", "destructive", "outline", "secondary", "ghost", "link"],
              "size": ["default", "sm", "lg", "icon"]
            },
            "defaults": { "variant": "default", "size": "default" }
          }
        }
      ]
    }
    /* … popover.tsx, dropdown-menu.tsx … */
  ],
  "summary": {
    "componentCount": 20,
    "uniqueTokensUsed": ["accent", "border", "destructive", "popover", "primary", ...],
    "antiPatternTotals": {
      "hardcodedPaletteColors": 0, "hexLiterals": 0, "rgbHslLiterals": 0, "arbitraryPx": 1
    }
  }
}
```

### 2.3 Usage

```bash
# Default trio (Button / Popover / Dropdown) → stdout
node scripts/extract-design-metadata.mjs > design-metadata.json

# Any set of files (e.g. audit the whole ui/ directory)
node scripts/extract-design-metadata.mjs packages/frontend/src/components/ui/*.tsx

# CI gate idea: fail when a component in ui/ regresses on hardcoded colors
node scripts/extract-design-metadata.mjs packages/frontend/src/components/ui/*.tsx \
  | node -e 'const r=JSON.parse(require("fs").readFileSync(0));
             const bad=r.files.flatMap(f=>f.components).filter(c=>(c.antiPatterns?.hardcodedPaletteColors||[]).length);
             if(bad.length){console.error("Hardcoded colors:",bad.map(c=>c.name));process.exit(1)}'
```

### 2.4 Validation performed

- **Positive:** run against Button/Popover/Dropdown → correctly extracts all
  variants, props (with origins), and the full token list (10 tokens on Button).
- **Negative:** run against `ui/toolbar.tsx` → correctly flags
  `ToolbarSeparator`'s `["bg-zinc-300","bg-zinc-700"]` under
  `hardcodedPaletteColors`, while `Toolbar`/`ToolbarButton` come back clean.

The script is committed at repo root under `scripts/`. Full source is that file
(≈280 lines, `@ts-check`-annotated); it is not duplicated here to keep this report
readable, but is the authoritative artifact for Mission 2.

---

## Mission 3 — Design ↔ Code Workflow Feasibility

### 3.1 The significant gaps (what to fix first)

Ranked by how hard they block an automated Figma→code SSOT:

| # | Gap | Why it blocks automation | Effort |
|---|-----|--------------------------|--------|
| **G1** | **Tokens are hand-authored `.ts`, not DTCG JSON.** `semantic.ts`/`palette.ts` are TypeScript objects; the build is one-way (`build-css.ts` → CSS). | Figma/Tokens Studio speak the **W3C DTCG** JSON token format. There is no interchange file for a design tool to read or write, so no round-trip is possible. | **M** |
| **G2** | **No spacing/sizing token tier.** Only color/radius/typography are tokens. 162 arbitrary `[Npx]`; Button uses raw `h-9 px-4`. | Figma auto-layout emits spacing tokens; with no target tier, they can't sync — spacing stays a free-for-all. | **M** |
| **G3** | **Incomplete semantic layer.** Missing `separator`/`border-strong`, `doc-accent-*`, and a type scale (`--text-display-lg`, PR #9 not started). | Every missing role becomes a hardcoded escape (`bg-zinc-300`, file-type `text-*-500`) that a lint gate must then either allow or block. | **S–M** |
| **G4** | **No component catalog** (Storybook/showcase — an explicit non-goal today). | Merge-class tools (UXPin, Supernova code-sync) and visual regression both need a rendered variant surface. Nothing renders `variant × size` today. | **L** |
| **G5** | **No CI token-lint gate.** `eslint.arch.config.js` enforces import architecture but nothing forbids hardcoded colors in `ui/`. | Compliance is a convention; the next contributor can regress it invisibly (as `toolbar.tsx` already did). | **S** |
| **G6** | **Custom non-Radix floating UI still exists** (`docs-link-popover.tsx`, comment popovers — PR #6 pending). | These bypass the `Popover`/`DropdownMenu` primitives and their tokens, so they will always drift from a synced source. | **M** |

### 3.2 Recommended SSOT architecture (Figma → GitHub → Frontend)

The good news: the existing `tokens/*.ts → build-css.ts → tokens.css` shape is
*already* a token-pipeline in miniature. The recommendation is to **swap the source
format and generalize the transform**, not to rebuild.

```text
┌─────────────────┐   Tokens Studio    ┌──────────────────────────┐   Style Dictionary   ┌───────────────────────┐
│      FIGMA      │  (GitHub sync via  │   GITHUB (wafflebase)    │  (replaces/augments  │   CONSUMERS           │
│  Tokens Studio  │───  PR to repo) ──▶│ packages/core/src/tokens/│──  build-css.ts) ───▶ │ • tokens.css (@theme) │
│    plugin       │◀── (2-way)         │  tokens.json  (DTCG)     │                       │ • tokens.ts constants │
└─────────────────┘                    │  = SINGLE SOURCE OF TRUTH│                       │ • sheets/docs/slides  │
                                       └────────────┬─────────────┘                       │   canvas theme.ts     │
                                                    │                                      └───────────────────────┘
                                        CI on every PR:
                                        1. Style Dictionary build (json → css + ts)
                                        2. token-lint  (extract-design-metadata.mjs --check: no hardcoded colors in ui/)
                                        3. design-metadata.json artifact (component API surface)
                                        4. (optional) DesignSync push of rendered variants → claude.ai Design System
```

**Component pieces:**

1. **SSOT = DTCG token JSON** in `packages/core/src/tokens/tokens.json`. Migrate
   the current `palette.ts`/`semantic.ts` values into DTCG groups
   (`color`, `radius`, `typography`, **add** `spacing`). The `.ts` constants become
   a *generated* output, not the source.
2. **Transform = Style Dictionary.** It reads DTCG JSON and emits multiple targets
   from one source: the existing `tokens.css` (`@theme`), the TS constants that
   `sheets`/`docs`/`slides` canvas themes import, and — if wanted — a `tokens.json`
   for the canvas engines. This directly generalizes today's `build-css.ts`.
3. **Design tool = Tokens Studio (Figma plugin).** It reads/writes DTCG JSON and
   has native **GitHub sync**: a designer edit becomes a PR against `tokens.json`,
   reviewed like any code change. This is the two-way link.
4. **CI enforcement (closes G5).** Add a `token-lint` step wired into
   `pnpm verify:fast` that runs `extract-design-metadata.mjs` in check mode over
   `components/ui/*.tsx` and fails on `hardcodedPaletteColors`/`hexLiterals`.
5. **Component metadata as artifact.** Run the extractor in CI, publish
   `design-metadata.json`. This is the machine-readable component API that a
   catalog or a Merge tool consumes — it already exists (Mission 2).
6. **Living preview surface.** For the *design-review* leg, this environment
   exposes Anthropic's **`DesignSync` tool + `/design-sync` skill**, which push a
   local component library (per-variant HTML previews) into a **claude.ai Design
   System project** incrementally. Paired with the extractor's JSON, this gives a
   hosted, shareable catalog **without standing up Storybook** — the lowest-lift
   path to G4. (No push was performed in this audit — it is an outward-facing
   action and requires explicit authorization.)

### 3.3 Toolchain comparison & verdict

| Toolchain | Fit for WaffleBase | Lift | Recommendation |
|-----------|--------------------|----- |----------------|
| **Tokens Studio + Style Dictionary** | Excellent — git-native, open, DTCG, mirrors the existing `build-css.ts` mental model | **Low–Med** | ✅ **Primary. Adopt first.** |
| **DesignSync / `/design-sync` (Claude-native)** | Great for a living catalog + design-review sync; complements the token pipeline | **Low** | ✅ **Adopt for the preview/catalog leg** (replaces "need Storybook first") |
| **Supernova** | Strong docs/token portal, but hosted and heavier; overlaps Style Dictionary | **Med** | ⚠️ Optional later, if a public design portal is wanted |
| **UXPin Merge** | Renders *real React* in the design tool — powerful, but **requires a Storybook/component server** WaffleBase doesn't have (G4) | **High** | ❌ Defer until a catalog exists |

**Overall feasibility:**

- **Token SSOT pipeline (Figma↔JSON↔CSS/TS): HIGH.** The foundation is already
  TS-tokenized behind one build script and one `@theme` mapping. The work is
  reformatting to DTCG + adopting Style Dictionary + a lint gate — incremental,
  low-risk, and each step ships independently.
- **Full design-tool Merge (UXPin/Supernova live components): MEDIUM**, gated on
  building a component catalog first (G4) — for which `DesignSync` is the cheapest
  on-ramp.

### 3.4 Suggested rollout (maps onto the existing PR roadmap)

1. **P0 — CI token-lint** (G5). Wire `extract-design-metadata.mjs --check` into
   `verify:fast`. Cheapest, stops regressions immediately. Fix `toolbar.tsx`'s
   `zinc` escape by adding a `--separator` token (also closes part of G3).
2. **P0 — DTCG migration** (G1). Convert `tokens/*.ts` → `tokens.json`, introduce
   Style Dictionary as the transform, keep outputs byte-identical (verify with the
   existing contrast tests + light/dark smoke).
3. **P1 — Spacing tier + type scale** (G2, G3). Aligns with roadmap PR #9. Retire
   the arbitrary-px tail.
4. **P1 — Tokens Studio GitHub sync** (G1 two-way). Connect Figma once `tokens.json`
   is the source.
5. **P1 — Catalog via DesignSync** (G4). Publish rendered variants; feed the
   extractor JSON as the API index.
6. **P2 — Floating-UI consolidation** (G6). Finish roadmap PR #6 so no styled
   surface lives outside the primitives.

---

## Appendix — Files & artifacts produced

| Artifact | Path | Purpose |
|----------|------|---------|
| This report | `design-editor-audit.md` | Missions 1–3 |
| Extraction script | `scripts/extract-design-metadata.mjs` | Mission 2 — AST metadata extractor (no new deps) |

**Key source files referenced:** `packages/frontend/src/components/ui/{button,popover,dropdown-menu,toolbar}.tsx`,
`packages/frontend/src/index.css`, `packages/core/src/tokens/{palette,semantic,radius,typography}.ts`,
`packages/frontend/src/components/{formatting-colors.ts,app/documents/document-list.tsx,app/docs/docs-link-popover.tsx}`,
`docs/design/design-system-unification.md`.
