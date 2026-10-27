---
name: deck-author
description: Turn a folder of source materials into a native Wafflebase deck through a verify-gated loop — plan, author, lint, render, fix
safety: destructive
tools:
  - wafflebase slides create
  - wafflebase slides set-content
  - wafflebase images upload
  - wafflebase slides layout-report
  - wafflebase slides lint
  - wafflebase slides render
---

# Author a Deck from Source Materials (the verify-gated loop)

Turn a folder of **source materials** (reference docs + images) into a
finished, native Wafflebase deck: **plan → author → lint → render → fix →
repeat**, checking the deck deterministically on every pass and on
wafflebase's *own* renderer before calling it done.

This builds on [slides-author.md](slides-author.md): that skill covers *how
to author one native deck* — the layout vocabulary, the design rules, the
theme ids. This skill covers the *loop around it*: ingesting sources,
composing richer slides from validated pieces, and gating each pass on the
linter plus a real render. Read `slides-author.md` first; everything there
still applies (one layout per idea, decoration from the template not ad hoc,
no fabricated data, bracketed hints for the user's own values).

Non-goals: this does **not** replace the screenshot-free `hunt-ui` hunter
(`scripts/agent/charters-ui/slide-author.md`) — the render here is an
additive lane. Fanning slides out to parallel workers is the agent runtime's
job, not something the CLI does.

## Safety

| Step | Safety | Notes |
|------|--------|-------|
| `slides create`, `images upload` | write | New deck / new workspace image |
| `slides set-content <id>` | destructive | Replaces the **whole** deck. On a deck you did not just create, make a restore point first (`wafflebase docs copy <id>`) and confirm with the user |
| `slides layout-report`, `slides lint`, `slides render` | read-only | `--file` reads a local deck; no network |

## Inputs: a source-material folder

```
talk/
  outline.md           # optional: your own outline / notes / script
  *.md, *.txt, *.pdf   # reference material to draw from
  figures/*.png|jpg|svg
```

Nothing about the folder shape is enforced — you read it and plan. The one
rule is the same as `slides-author.md`: **draw only on facts the sources
actually contain.** No invented numbers; where a value is the user's to
fill, write a bracketed hint (`<team>`, `<date>`).

## The loop

### 1. Plan (from the sources)

Read the folder. Produce a slide-by-slide outline: for each slide pick the
**layout** (from `slides-author.md`'s table) or the **compositions** (below)
that fit the idea, and the text/figure it carries. Let the content set the
slide count — never pad. Pick one theme for the whole deck (theme ids are in
`slides-author.md`).

### 2. Author (compose from validated pieces)

The reusable **compositions** live in the repository at
`packages/backend/src/template/seed/compositions.ts`, so an agent working in
a wafflebase checkout assembles slides from tested pieces instead of
hand-writing raw element JSON (where blind authoring produced overlaps and
invalid shapes). Each returns plain `Element[]` in the 1920×1080 slide
space, coloured by **theme roles** so it follows the deck's theme:

| composition | use for |
| --- | --- |
| `kicker(text, {x?, y?, w?, uppercase?, color?})` | an eyebrow/overline label above a title |
| `calloutCard({title?, body, box?, tail?, fill?, accent?})` | a callout / note card (`tail: false` = plain rounded card) |
| `codeBlock(code, {x?, y?, w?, fontSize?, panel?, color?})` | a monospace code panel; newlines kept, height sized from the line count |
| `table(headers, rows, {x?, y?, w?, fontSize?, columnWidths?})` | a native table; ragged rows padded, header-less when `headers` is `[]` |
| `bigNumberCard(number, label, {box?, accent?})` | a single-metric KPI card (`number` is a string: `"98%"`, `"$4.2M"`) |
| `footer(text, {right?})` | a footer rule + caption (+ right-aligned label) — the only piece allowed below `FOOTER_TOP` |
| `diagram(svg, {src?, alt?, box?})` | an SVG figure as a fitted, centred image |

Every composition also takes `id` (an id prefix, unique per slide).
Helpers and constants: `addElements(slide, ...parts)` appends compositions
in paint order (later = on top); `frameOf(els)` returns a composition's
bounding box so the next piece stacks by arithmetic; `MARGIN` (80),
`CONTENT_W`, `FOOTER_TOP` describe the safe area.

What the builders guarantee, and what they do not:

- A builder **throws** rather than emit a frame outside the safe area
  (`MARGIN` on each side, above `FOOTER_TOP`); `codeBlock` also throws when
  a line would not fit the width, `table` when it would reach the footer,
  `diagram` when the SVG has neither a `viewBox` nor `width`/`height`. A
  thrown error is a layout bug caught before anything is written.
- They do **not** detect collisions with each other — stack them with
  `frameOf`. The linter (step 3) is what catches overlap.
- Their output passes `assertValidSlidesBody` (the validator `PUT
  /documents/:id/content` runs); the composition tests assert it.

**Assemble a `SlidesDocument`.** Build the deck with `themedDeck(themeId,
title, [[layoutId, texts], ...])` (or `deck()` / `slide()`) from
`packages/backend/src/template/seed/builders.ts`, append compositions to its
slides with `addElements(doc.slides[i], ...)`, and print the document as
JSON from a short TypeScript script (run with the backend's `tsx`, e.g.
`pnpm --filter @wafflebase/backend exec tsx build-deck.ts > deck.json`).

**Figures.** `diagram()` needs the SVG text for its aspect ratio either way.
Then:

- small SVGs: omit `src` and the SVG is embedded as a `data:` URI;
- anything larger: upload a **raster** copy and pass the returned `url` as
  `src`. `images upload` accepts png, jpeg, gif and webp only (10 MB max) —
  **not** SVG:

```bash
wafflebase images upload figures/arch.png      # → { "id": "...", "url": "/api/v1/workspaces/<wid>/images/<id>" }
```

PNG/JPEG photos are plain `image` elements: upload, then reference the
returned `url`. Never invent an image URL.

### 3. Check — deterministic, no rendering

Lint the local JSON **before** writing it anywhere:

```bash
wafflebase slides lint --file deck.json                       # all rules, advisory (exit 0)
wafflebase slides lint --file deck.json --fail-on warning     # exit 1 on any open warning or error
wafflebase slides lint --file deck.json --rules overflow,overlap --slide 3
wafflebase slides layout-report --file deck.json --slide 3    # per-element layout, for diagnosis
```

Both accept a server deck instead (`<doc-id>`, exactly one of `<doc-id>` or
`--file`), and `--file` also reads a `.pptx`. `layout-report` prints one row
per element: `slide, element, type, x, y, w, h, visible` (on-slide
fraction) and, for text, `autofit, lines, textHeight, boxHeight, shrink,
overflows`. (`slides layout` is **not** this command — it is an alias of
`slides layouts`, which lists a deck's layout ids.)

`lint` prints one row per open finding — `slide, rule, severity, element,
text, message` (`text` is the element's first 40 characters). The six rules:

| rule | flags | severity |
| --- | --- | --- |
| `overflow` | `shrink` text taller than its box even at the minimum shrink scale | error |
| | `none` text with at least one whole line painted outside its box | warning |
| | text in a **filled or bordered** box (a chip, a card) spilling past the drawn edge, even by part of a line | warning |
| `out-of-bounds` | text, tables or charts past the slide edge (text judged by its ink); a text-less shape or image only when entirely off the slide | error when entirely off, else warning; info for text-less |
| `overlap` | two elements, at least one with text, intersecting by ≥ 15% of the smaller (backgrounds, thin ≤ 24 px decoration, an enclosing text-less card and text merely beside an image are excluded) | warning |
| `contrast` | text below WCAG AA — 4.5:1, or 3:1 for large text (18 pt, 14 pt bold) — against its fill, the shapes beneath and the slide background; skipped over images/tables/charts | error below 3:1, else warning |
| `min-font` | text rendering below 12 slide points (9 for footer-like text) | error below 75% of the minimum, else warning |
| `edge-margin` | text ink within 0.5 in of a slide edge (footer-like text exempt) | info |

`grow` text (the default autofit) is never an `overflow` finding — a box
that grows past the slide is `out-of-bounds`'. Line breaks in Node come from
a font-free width estimate that errs toward reporting overflow that is not
there: a finding is a reason to look, and the render (step 5) settles it.

**Intentional findings go in an allowlist, with a reason** — never tune a
rule away:

```json
[
  { "rule": "overlap", "slideId": "<slide-id>", "elementId": "<element-id>",
    "reason": "Label sits on the photo on purpose" },
  { "rule": "contrast", "slideId": "<slide-id>", "text": "Q3 · draft",
    "reason": "Watermark, meant to be faint" }
]
```

```bash
wafflebase slides lint --file deck.json --allowlist allow.json --fail-on warning
```

An entry matches rule + `slideId`, then the element by `elementId`, else by
a prefix of its `text` (use this for a deck re-imported from PPTX, whose
element ids change on every import), else any element on that slide. An
entry without a non-empty `reason` is rejected. stderr reports how many
findings the allowlist accepted and how many entries matched nothing
(stale — delete them).

### 4. Write

```bash
wafflebase slides create "<title>"              # → note the returned id
wafflebase slides set-content <doc-id> < deck.json
```

`set-content` takes the JSON on **stdin** (or inline via `--data '<json>'`);
there is no `--file` flag. It replaces the whole deck — see Safety.

### 5. Render on the real renderer

```bash
wafflebase slides render <doc-id> --out ./shots              # slide-1.png, slide-2.png, …
wafflebase slides render <doc-id> --out ./shots --slide 3 --force
```

Pixels come from wafflebase's own editor renderer at the deck's logical
size (1920 wide), **not** `soffice` or another substitute — during
validation a substitute renderer reported serif/overlap bugs the real one
did not have. `slides render` drives headless Chromium to the deck's editor
page, so it needs:

- Playwright + Chromium (`npm install playwright && npx playwright install
  chromium`); without them it fails with that install hint;
- a `wafflebase login` session — API keys cannot sign a browser in;
- the web app reachable: inferred as `http://localhost:5173` for a loopback
  server or the parent domain of an `api.` host, otherwise pass
  `--frontend <url>` (or set `WAFFLEBASE_FRONTEND_URL`).

Existing PNGs are not overwritten without `--force`.

In a wafflebase checkout you can render the local JSON before writing it,
with no backend or login: `pnpm frontend render:slides deck.json --out
./shots [--slide N]` (same `slide-N.png` names; it takes the bare
`SlidesDocument` JSON).

Look at every PNG for what geometry cannot see: font fallback, text over
images, a slide that is technically clean but reads badly.

### 6. Fix → repeat

Address each finding (swap the layout, shorten text, re-place a
composition, or allowlist it with a reason), then rerun 3–5. Stop when
`slides lint --fail-on warning` exits 0 and the PNGs read clean.

## Checklist

- [ ] Planned from the sources; slide count set by content, one theme chosen.
- [ ] Every raster figure `images upload`ed; no invented URLs or facts.
- [ ] Authored from layouts + compositions; no builder threw.
- [ ] `slides lint --fail-on warning` exits 0; every allowlist entry has a reason, none stale.
- [ ] `set-content` accepted the deck.
- [ ] `slides render` produced a PNG per slide; each one looked at.
