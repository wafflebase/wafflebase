# Skill: authoring native Wafflebase slides

Create a **native** Wafflebase slide deck — one that uses the product's own
themes, layouts and placeholders — rather than generating a `.pptx` and
importing it. Import is a lossy conversion (a rendered pptx can still break on
import) and flattens away the layout/placeholder structure that makes a deck a
usable, editable *template*. Authoring natively keeps all of it.

Two surfaces share the same slide model; pick by where the deck must land:

- **A live workspace** → the CLI: `wafflebase slides create` + `wafflebase
  slides set-content` (this skill's main path).
- **The shipped template gallery** → the backend seed catalogue
  (`packages/backend/src/template/seed/catalog/slides.ts`), authored in
  TypeScript with the `deck()` / `slide()` helpers in `../builders`. Same
  layouts, same rules; see "Seed-catalogue form" below.

## The layout vocabulary

A slide is built on ONE built-in layout. The layout owns the frames, fonts and
colour roles (from the theme); you only supply the **text for each
placeholder, in slot order**. Never hard-code positions or colours — choose the
layout whose slots match the idea.

| layout id | slots, in order | use for |
| --- | --- | --- |
| `title-slide` | title, subtitle | the cover |
| `section-header` | title | a divider between parts |
| `section-title-description` | title, body | a divider that needs a sentence |
| `title-body` | title, body | the workhorse: a heading + points |
| `title-two-columns` | title, left body, right body | compare / two lists |
| `main-point` | title | one sentence that must land alone |
| `big-number` | number, caption | a single metric |
| `one-column-text` | body | a quote or a full-bleed passage |
| `caption` | body, caption | body with a source/footnote line |
| `title-only` | title | a heading over content you add later |
| `blank` | (none) | start from nothing |

Each slot takes an **array of lines**; in a `body` slot each line becomes its
own paragraph (not a bulleted list — the seed builder emits `paragraph` blocks).
An omitted slot stays the empty placeholder the layout seeded (that is
what an unfilled placeholder is — leave it for the user to fill).

## Design rules (what keeps it from looking AI-generated)

- **One layout per idea.** A statement is `main-point`; a metric is
  `big-number`; a comparison is `title-two-columns`. Do not force everything
  into `title-body`.
- **Decoration comes from the template, not ad hoc.** A deck's look is its
  `Decor` preset (spine, band, sidebar, geo…) applied consistently across every
  slide — that is the design, keep it. What reads as AI-generated is *one-off*
  accents dropped on a single slide; the inconsistency is the tell, not the
  decor. Don't add stray stripes or underlines outside the deck's chosen Decor.
- **Follow the source's own structure**, and let content set the slide count —
  never pad to a template's fixed length.
- **Bullets are parallel and short**: 3–5 per slide, one line each, same
  grammar. If a slide needs more, split it.
- **No fabricated data.** Only chart real numbers the source actually has — and
  the native model cannot author charts from scratch anyway (charts arrive only
  via pptx import), so use a table, a `big-number`, or a short list instead.
- **Placeholders for the user**: where a value is the user's to fill, write a
  bracketed hint (`<team>`, `<date>`, `—`) rather than inventing a fact.

## CLI form (live workspace)

1. `wafflebase status` to confirm login + active workspace.
2. `wafflebase slides create "<title>"` → note the returned document id.
3. `wafflebase slides set-content <doc-id> --file deck.json` where `deck.json`
   is a `SlidesDocument` snapshot (see `wafflebase slides set-content --help`
   and `packages/slides/src/model` for the shape). Author it with the layouts
   above.
4. **Visual QA**: `wafflebase slides export tmp.pptx` → render (the built-in
   renderer, or `soffice --headless --convert-to pdf` then `pdftoppm`) → look at
   every slide → fix overflow / misalignment / uneven spacing → repeat until
   clean.

## Seed-catalogue form (shipped gallery)

Add a `TemplateSeed` to `catalog/slides.ts` (or a new `catalog/slides-*.ts`),
register it in `catalog/index.ts`, then `pnpm backend test -- seed` (runs every
seed through the same validators `PUT /documents/:id/content` applies). Shape:

```ts
export const sprintRetrospective: TemplateSeed = {
  slug: 'sprint-retrospective',      // identity, never changes
  title: 'Sprint Retrospective',
  description: 'One sentence on what the template is for.',
  category: 'Project management',    // a TemplateCategory: Business | Education |
                                     // Personal | Project management | Finance |
                                     // Marketing | Design | Other
  tags: ['deck', 'retro', 'agile'],  // freeform, <=10, lowercased on write
  content: {
    kind: 'slides',
    // themedDeck(themeId, title, [[layoutId, texts], ...]).
    document: themedDeck('slate', 'Sprint Retrospective', [
      ['title-slide', [['Sprint Retrospective'], ['<team> · Sprint <n>']]],
      ['title-body', [['What went well'], ['Keep doing —', 'Keep doing —']]],
      [
        'title-two-columns',
        [['Action items'], ['Action', '—', '—'], ['Owner', '—', '—']],
      ],
      ['main-point', [['One thing we change next sprint']]],
    ]),
  },
};
```

## Themes — give each template a distinct look

`themedDeck(themeId, …)` embeds a built-in theme (fonts + colour palette +
background) in the deck, so **each template reads as a different design**, not
the same one with different words. **Pick a distinct theme per template.** The
ids (`import`/resolve via the registry; an unknown id throws):

`default-light` · `default-dark` · `streamline` · `swiss` · `paradigm` ·
`material` · `shift` · `momentum` · `focus` · `luxe` · `modern-writer` ·
`coral` · `spearmint` · `pop` · `tropic` · `marina` · `geometric` · `plum` ·
`slate` · `forest` · `spotlight` · `beach-day` · `wafflebase`

Match the theme to the subject: `luxe`/`modern-writer` (serif, editorial),
`slate`/`marina`/`paradigm` (dark, technical), `pop`/`coral`/`spearmint`
(vibrant), `material`/`swiss`/`streamline` (clean corporate), `focus` (warm
academic), `spotlight`/`geometric` (bold poster).

Licensing: everything in the catalogue is original to this repo (Apache-2.0).
Nothing derived from Canva / Slidesgo / Google / Microsoft galleries may be
added — see `catalog/README.md`.
