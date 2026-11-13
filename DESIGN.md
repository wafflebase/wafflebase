---
name: Wafflebase
description: A self-hosted collaborative office suite — quiet, ruled editors with a warm syrup-and-butter signature.
colors:
  syrup: "#B8651A"
  syrup-deep: "#8A4A12"
  syrup-bright: "#E08A3A"
  butter: "#F4C95D"
  berry: "#C2484C"
  berry-bright: "#E27A7E"
  leaf: "#5A7A3A"
  leaf-bright: "#A0C078"
  cream-bg: "#FBF6EC"
  cream-paper: "#FFFDF7"
  walnut-ink: "#2A1E12"
  cocoa-sub: "#6B584A"
  oat-rule: "#E8DCC4"
  roast-bg: "#1C1610"
  roast-paper: "#241D14"
  roast-sub: "#B5A48A"
  roast-rule: "#3A2E1F"
  on-syrup: "#FFFAF0"
  app-background: "oklch(1 0 0)"
  app-foreground: "oklch(0.141 0.005 285.823)"
  app-muted: "oklch(0.967 0.001 286.375)"
  app-muted-foreground: "oklch(0.552 0.016 285.938)"
  app-border: "oklch(0.92 0.004 286.32)"
  app-sidebar: "oklch(0.985 0 0)"
  app-background-dark: "oklch(0.141 0.005 285.823)"
  app-card-dark: "oklch(0.21 0.006 285.885)"
  app-muted-dark: "oklch(0.274 0.006 286.033)"
  destructive: "oklch(0.577 0.245 27.325)"
  warning: "oklch(0.555 0.163 48.998)"
typography:
  display:
    fontFamily: "Fraunces, ui-serif, Georgia, serif"
    fontSize: "clamp(40px, 6vw, 68px)"
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Fraunces, ui-serif, Georgia, serif"
    fontSize: "28px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  body-brand:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(17px, 1.4vw, 19px)"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
  label-mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    letterSpacing: "0.08em"
rounded:
  sm: "0.8px"
  md: "2.8px"
  lg: "4.8px"
  xl: "8.8px"
  brand-card: "16px"
  pill: "9999px"
spacing:
  hairline: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.syrup}"
    textColor: "{colors.on-syrup}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.app-background}"
    textColor: "{colors.app-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost:
    textColor: "{colors.app-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.app-muted}"
  toolbar-button:
    textColor: "{colors.app-foreground}"
    rounded: "{rounded.md}"
    size: "28px"
  toolbar-button-hover:
    backgroundColor: "{colors.app-muted}"
  input:
    textColor: "{colors.app-foreground}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.app-background}"
    textColor: "{colors.app-foreground}"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge:
    backgroundColor: "{colors.syrup}"
    textColor: "{colors.on-syrup}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "2px 8px"
  brand-button-primary:
    backgroundColor: "{colors.syrup}"
    textColor: "{colors.on-syrup}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
  brand-button-primary-hover:
    backgroundColor: "{colors.syrup-deep}"
  brand-button-ghost:
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
  brand-card:
    backgroundColor: "{colors.cream-paper}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.brand-card}"
    padding: "28px 24px 24px"
---

# Design System: Wafflebase

## Overview

**Creative North Star: "The Ruled Ledger"**

Wafflebase is a set of ledgers: grids, pages, slides and boards laid out on
precise rules, where the document is the subject and everything around it is
ruling and margin. The editors are dense, exact and quiet. Chrome sits on
neutral zinc, thin borders do the work that shadows would do elsewhere, and
controls stay small (28px toolbar targets, 36px form controls) so the canvas
gets the room.

Warmth is the ledger's binding, not its pages. The Butter & Maple palette
(syrup, butter, cream paper, walnut ink) and the Fraunces display face set
the brand surfaces: the homepage, sign-in, the template gallery and the
sidebar wordmark. Inside the editors that warmth survives only as the syrup
accent on the primary action, focus ring, selection and active sidebar item.
That split is deliberate, and new work keeps it.

The ruler is the recurring motif: the homepage's word-ruler backdrop, the
docs and slides rulers, the grid itself, and mono uppercase labels set like
tick marks.

**Key Characteristics:**
- Two layers on one token source (`@wafflebase/core/tokens`): neutral editor chrome, warm brand surfaces.
- One accent, syrup, carrying every "this is the action" signal.
- Flat by default: borders and tonal steps before shadows.
- Small, exact controls; Google-suite-familiar placement inside the editors.
- Light and dark are paired token for token; neither is an afterthought.

## Colors

A cool, near-colorless working surface with a single warm syrup accent; the
brand layer swaps the zinc for cream paper and walnut ink.

### Primary
- **Maple Syrup** (syrup): the one accent. Primary buttons, focus rings, text selection, chart series 1, active sidebar item. In dark mode it becomes **Bright Syrup** (syrup-bright) so it holds contrast on roast surfaces.
- **Deep Syrup** (syrup-deep): pressed/hover state of the brand primary button, the active sidebar item's text, and brand eyebrows.

### Secondary
- **Butter** (butter): highlight, never text. Sidebar active-item wash (30% light / 18% dark), brand eyebrow pills, the waffle illustrations.

### Tertiary
- **Berry** (berry / berry-bright): brand-surface error and emphasis, and the sheet engine's reference highlights.
- **Leaf** (leaf / leaf-bright): live and success signals, such as the homepage's "live" dot.

### Neutral
- **Zinc Paper** (app-background) and **Zinc Ink** (app-foreground): editor chrome, dialogs and popovers in light mode.
- **Zinc Wash** (app-muted) / **Zinc Sub** (app-muted-foreground): hover fills, secondary text, placeholders.
- **Zinc Rule** (app-border): every hairline in the app: toolbars, panels, inputs, cards.
- **Cream** (cream-bg) / **Cream Paper** (cream-paper): brand-surface page and raised paper.
- **Walnut Ink** (walnut-ink) / **Cocoa** (cocoa-sub) / **Oat Rule** (oat-rule): brand-surface text, secondary text and borders.
- **Roast** (roast-bg, roast-paper, roast-sub, roast-rule): the brand layer's dark pair. The app's dark chrome stays on zinc (app-background-dark, app-card-dark, app-muted-dark).

### Named Rules
**The One Accent Rule.** Syrup is the only chromatic signal in editor chrome. If two things on a toolbar are syrup, one of them is wrong.

**The Two Ledgers Rule.** Editor and workspace screens use the zinc semantic tokens (`bg-background`, `text-foreground`, `border`). Brand surfaces use the `--wb-*` tokens. Don't mix them on one surface.

**The Canvas Hex Rule.** Brand colors are authored as hex because the Canvas engines assign them straight to `fillStyle`. Add a new brand color to `packages/core/src/tokens/palette.ts`, never inline in an engine.

## Typography

**Display Font:** Fraunces (with ui-serif, Georgia)
**Body Font:** the system UI stack in the app; Inter (with ui-sans-serif, system-ui) on brand surfaces
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo)

**Character:** An old-style serif with optical sizing for the brand's voice, set tight and heavy. A plain sans does the work in the editors, and a mono marks code and tick-mark labels.

### Hierarchy
- **Display** (600, clamp(40px, 6vw, 68px), 1.04, -0.025em): homepage hero only, with an italic syrup-deep second line.
- **Headline** (600, 28px, -0.02em): brand-surface page titles (sign-in, template landing). The sidebar wordmark uses the same face at 17px.
- **Title** (600, 16px, 1): card and dialog titles in the app.
- **Body** (400, 14px): all editor and workspace UI text. Inputs render at 16px on mobile, which prevents iOS zoom-on-focus.
- **Body (brand)** (400, clamp(17px, 1.4vw, 19px), 1.55): homepage lead paragraphs, max ~560px measure.
- **Label** (500, 12px): badges, small metadata.
- **Label (mono)** (400, 11.5–13px, 0.08em, uppercase): brand eyebrows, stat captions, section numbers.

### Named Rules
**The Serif Is a Signature Rule.** Fraunces never appears inside an editor or on a control. It is the brand's voice, used for wordmarks and brand-surface headings only.

**The Document Owns Its Fonts Rule.** Text inside a sheet, doc or slide uses the document's own font picker (the curated family list and Google Fonts catalog), never the UI stack.

## Layout

The app shell is a collapsible left sidebar, a header row (title, sync chip, presence, share), a single-row toolbar, and the document canvas filling the rest. Editors are dense: toolbars are 36px tall with 28px buttons and 2px gaps, grouped by thin vertical separators (20px high). On coarse pointers, toolbar targets grow to 44px and the toolbar scrolls horizontally rather than wrapping.

Spacing follows a 4px base (`xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 24). Cards and dialogs pad at 24px, with 24px gaps between their sections.

Brand surfaces are single-column scrolls centred at ~920px for the hero and wider for feature grids (3 columns at ≥768px, 1 below), with 64–80px vertical section padding.

Responsive behavior branches at 768px. Below it, Slides and Sheets switch to dedicated mobile shells (bottom sheets, FABs) instead of shrinking the desktop toolbar.

## Elevation & Depth

Flat by default. App surfaces separate by a 1px zinc rule and a tonal step (background, then muted, then card), not by lift. Shadows are tiny and appear in three places only: a near-invisible `xs` under buttons and inputs, `sm` under cards, and the larger popover/dialog elevation for things that float above the canvas. The brand layer allows one soft, warm-tinted card shadow and a pressed-paper inset on its primary button, and nothing deeper.

### Shadow Vocabulary
- **Hairline lift** (`0 1px 2px 0 rgb(0 0 0 / 0.05)`): buttons and inputs at rest.
- **Card rest** (`0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)`): app cards.
- **Brand card** (`0 1px 0 rgba(42,30,18,0.04), 0 12px 28px -16px rgba(42,30,18,0.18)`): homepage feature cards; lifts by 2px on hover.
- **Brand primary bevel** (`0 1px 0 var(--wb-syrup-deep), inset 0 1px 0 color-mix(in srgb, white 25%, transparent)`): the pill CTA's pressed-syrup edge.

### Named Rules
**The Rule Before Shadow Rule.** Reach for a 1px border or a tonal step first. A shadow means the element floats above the canvas (menu, popover, dialog, drag ghost), not that it's important.

## Shapes

Corners are barely softened in the app. The radius base is 0.3rem (4.8px): controls take `md` (2.8px), and cards and dialogs take `xl` (8.8px). The brand layer is rounder on purpose: pill CTAs and eyebrow chips, 16px cards. Borders are always 1px. The waffle grid is the one decorative geometry and appears only as brand illustration.

## Components

### Buttons
Precise and restrained.
- **Shape:** gently squared (2.8px). Sizes are 32px (`sm`), 36px (default), 40px (`lg`) and a 36px square icon button.
- **Primary:** syrup fill, warm off-white text, 14px medium, 8px 16px padding; hovers to 90% syrup.
- **Hover / Focus:** a 3px ring in 50% syrup plus a syrup border on `:focus-visible`. Disabled fades to 50% and ignores the pointer.
- **Outline / Secondary / Ghost / Link:** outline is a zinc-bordered background button; secondary is a zinc-wash fill; ghost shows a wash only on hover; link is syrup text, underlined on hover. Destructive uses the destructive red fill.

### Toolbar buttons (signature)
- **Style:** 28×28 icon (`icon`) or labelled-with-caret (`menu`, 6px side padding), 2.8px corners, transparent at rest, zinc wash on hover.
- **State:** toggled state belongs to `Toggle`, not this component. Groups are divided by 20px vertical separators.

### Inputs / Fields
- **Style:** 36px high, 1px zinc border, transparent fill (15% white tint in dark), 2.8px corners, 12px side padding, hairline lift.
- **Focus:** the same 3px 50%-syrup ring and syrup border as buttons.
- **Error / Disabled:** `aria-invalid` turns the border and ring destructive red. Disabled fades to 50%.

### Cards / Containers
- **Corner Style:** 8.8px.
- **Background:** card token (white light, raised zinc dark).
- **Shadow Strategy:** card rest (see Elevation).
- **Border:** 1px zinc rule.
- **Internal Padding:** 24px, with 24px gaps between header, content and footer.

### Chips / Badges
- **Style:** 12px medium label, 2px 8px padding, 2.8px corners. Default is syrup on off-white; secondary, outline and destructive variants follow the button roles.

### Navigation
- **Sidebar:** near-white zinc (`sidebar`), with the Fraunces wordmark at 17px. The active item is a butter wash with deep-syrup text and the hover a neutral wash. It collapses to an icon rail.

### Brand pill button (brand surfaces only)
- **Style:** fully rounded, Inter 14–15px medium, syrup fill with a deep-syrup border and bevel. It hovers to deep syrup and lifts 1px. The ghost variant is an oat-rule outline on walnut ink.

## Do's and Don'ts

### Do:
- **Do** take every color from `@wafflebase/core/tokens` (semantic classes in the app, `--wb-*` on brand surfaces), in both light and dark.
- **Do** keep editor controls at 28px (toolbar) and 36px (forms) on fine pointers, and let them grow to 44px on coarse pointers.
- **Do** use the 3px 50%-syrup focus ring for every focusable control.
- **Do** separate panels with 1px rules and tonal steps before considering a shadow.
- **Do** place and behave like the Google suite in the editors (menus, toolbar order, shortcuts).

### Don't:
- **Don't** use Fraunces, cream paper or pill buttons inside an editor or workspace screen.
- **Don't** introduce a second accent color in editor chrome; status colors (destructive, warning, leaf) are for status only.
- **Don't** hard-code a hex in a component or engine when a token exists.
- **Don't** add decorative shadows or gradients to app chrome.
