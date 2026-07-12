---
title: slides-font-ooxml-parity
target-version: 0.6.0
---

# Slides Font OOXML Parity

## Summary

Slides text boxes reuse the Docs rich-text engine, so per-run character
formatting is stored in the shared `InlineStyle` type
(`packages/docs/src/model/types.ts`). Today that type — and the Slides
toolbar/import/export around it — covers only a subset of what OOXML
`<a:rPr>` (`CT_TextCharacterProperties`) can express, and what
PowerPoint / Google Slides let a user edit. Several properties are
already modeled and parsed on import but are silently dropped on PPTX
export or hidden from the Slides toolbar.

This document defines a **staged roadmap** to grow font/character
formatting toward full OOXML parity. Each stage touches the same five
layers together so no property round-trips lossily:

1. **Model** — `InlineStyle` (shared) or a Slides-side extension.
2. **Renderer** — the Canvas text painter in the docs/slides engine.
3. **Import** — `parseRunStyle` in `packages/slides/src/import/pptx/text.ts`.
4. **Export** — `rPrXml` in `packages/slides/src/export/pptx/text.ts`.
5. **UI** — the shared text-formatting controls
   (`packages/frontend/src/components/text-formatting/`) surfaced in the
   Slides text-edit toolbar.

The near-term work is **Phase A** (wire up already-modeled properties);
later phases extend the model.

### Goals

- A single, ordered plan from the current subset to OOXML `<a:rPr>`
  parity, with each phase shippable as an independent PR.
- Eliminate the existing round-trip losses where a property is imported
  but not exported (superscript/subscript, hyperlink).
- Reach Google-Slides feature parity early (strikethrough, highlight,
  super/subscript UI) before adding PowerPoint-only depth.
- Keep the shared `InlineStyle` lean: universal typographic properties
  go in the shared model (Docs benefits too); presentation-only text
  effects live in a Slides-side extension.

### Non-Goals

- Variable-font weight/optical-size axis UI (kept out per
  [slides-fonts.md](slides-fonts.md); the weight model stays
  bold/regular).
- `kumimoji`, `normalizeH`, `noProof`/`dirty`/`err` and other
  authoring-metadata `<a:rPr>` attributes with no rendering effect.
- Paragraph-level (`<a:pPr>`) properties — this doc is scoped to run
  (character) properties only.
- Font embedding / upload (tracked in [slides-fonts.md](slides-fonts.md)).

## Proposal Details

### Model strategy

`InlineStyle` is shared between Docs and Slides. The extension rule:

- **Universal typographic properties** → add to the shared
  `InlineStyle` in `packages/docs/src/model/types.ts`. These are
  meaningful in a flowing document too, so Docs gains them for free.
  Examples: underline style/color, double strikethrough, all/small
  caps, letter spacing.
- **Presentation-only text effects** → add to a **Slides-side
  extension** rather than the shared type, to avoid bloating the Docs
  model with things Google Docs has no concept of. Examples: text
  gradient fill, text outline, text drop-shadow/reflection/glow. These
  reuse the existing Slides shape `GradientFill` / `effects` models.
- **Backward compatibility** — never repurpose an existing field.
  `underline: boolean` and `strikethrough: boolean` stay as the on/off
  switches; style and color arrive as *optional companion fields*
  (`underlineStyle?`, `underlineColor?`, `strikeStyle?`), so no data
  migration is required and older documents keep rendering.

Every new field is optional (`undefined` = inherit/default), matching
the existing `InlineStyle` convention, and must be added to
`CLEAR_INLINE_STYLE` (the clear-formatting mask) when it is a formatting
property the user can reset.

### Current `<a:rPr>` coverage vs target

| OOXML | `InlineStyle` today | Import | Export | Slides UI | Target phase |
| --- | --- | --- | --- | --- | --- |
| `@b` bold | `bold` | ✅ | ✅ | ✅ | shipped |
| `@i` italic | `italic` | ✅ | ✅ | ✅ | shipped |
| `@sz` size | `fontSize` | ✅ | ✅ | ✅ | shipped |
| `<a:latin>` | `fontFamily` | ✅ | ✅ | ✅ | shipped |
| `<a:solidFill>` | `color` | ✅ | ✅ | ✅ | shipped |
| `@u` underline (on/off) | `underline` | ✅ | ✅ | ✅ | shipped |
| `@strike` (on/off) | `strikethrough` | ✅ | ✅ | ❌ hidden (deferred) | — |
| `<a:highlight>` | `backgroundColor` | ✅ | ✅ | ❌ hidden (deferred) | — |
| `@baseline` super/sub | `superscript`/`subscript` | ✅ | ✅ (A1) | ❌ (deferred) | A1 |
| `<a:hlinkClick>` | `href` | ✅ | ✅ (A2) | (link flow) | A2 |
| `@cap` all/small | — | ❌ | ❌ | ❌ | B.3 (deferred) |
| `@u` style + `<a:uFill>` | `underlineStyle`/`underlineColor` | ✅ (B.2) | ✅ (B.2) | ❌ (deferred) | B.2 |
| `@strike` dbl | `strikeStyle` | ✅ (B.1) | ✅ (B.1) | ❌ (deferred) | B.1 |
| `@spc` letter spacing | `letterSpacing` | ✅ (B.4) | ✅ (B.4) | ❌ (deferred) | B.4 |
| `<a:gradFill>` text fill | — | ❌ | ❌ | ❌ | C |
| `<a:ln>` text outline | — | ❌ | ❌ | ❌ | C |
| `<a:effectLst>` text effects | — | ❌ | ❌ | ❌ | C |
| `<a:ea>` / `<a:cs>` typefaces | — | ❌ (render fallback) | ❌ | n/a | D |

### Phase A — close PPTX round-trip losses (export only)

No shared-model field additions and **no Slides toolbar changes**. This
phase fixes two properties that the model already carries and the
importer already reads, but that the PPTX exporter silently dropped.

Scope decision: the slides text-edit toolbar is deliberately left
**unchanged** in Phase A. Exposing strikethrough / highlight /
super-subscript controls there is a separate product call (the toolbar
intentionally keeps a compact B/I/U cluster) and is deferred — see
[Deferred: toolbar exposure](#deferred-toolbar-exposure). The
round-trip fidelity fixes below stand on their own: content authored in
PowerPoint (or a future Slides UI) survives an import → export cycle.

**A1 — superscript / subscript baseline export**

- Export: emit `@baseline` in `rPrXml` — `superscript` →
  `baseline="30000"`, `subscript` → `baseline="-25000"` (inverse of the
  importer's sign test). Fixes the super/subscript round-trip loss. The
  renderer already paints super/subscript (`layout.ts` /
  `paint-layout.ts`), so imported PPTX content renders and now
  re-exports losslessly.

**A2 — hyperlink export (single PR)**

- Emit `<a:hlinkClick r:id="…">` for runs carrying `href`. This
  requires threading a relationship-adder through the text
  serialization chain (`textBodyToXml` → `blockToXml` → `runToXml` →
  `rPrXml`), mirroring how images thread `resolveImageRId` through
  `packages/slides/src/export/pptx/image.ts`. The relationship is
  slide-local (each slide has its own `.rels`) with an external
  `TargetMode="External"` target.
- Export href policy is intentionally **not** the importer's
  `isSafeHref` allowlist. Export requires an explicit scheme (a
  scheme-less/relative target would become a broken `External` relative
  path) and blocks only executable/local schemes (`javascript:`,
  `data:`, `vbscript:`, `file:`); every other scheme (`http(s)`,
  `mailto`, `tel`, `sms`, `ftp`, …) is a valid external target. The
  import guard stays an allowlist because it protects the web renderer
  from untrusted PPTX; the two policies serve different threat models.
- **Known limitation:** hyperlinks in speaker **notes** are not
  exported. `notesSlideToXml` gets no resolver, and symmetrically the
  importer's `parseNotes` calls `parseTextBody` without a rels map
  (`src/import/pptx/slide.ts`), so notes hyperlinks do not round-trip on
  either side. Wiring notes-part rels through both is deferred as a
  separate follow-up.

### Deferred: toolbar exposure

Surfacing strikethrough, highlight, and super/subscript controls in the
slides text-edit toolbar was prototyped and then intentionally **not
shipped** — the slides toolbar keeps its compact B/I/U cluster
(`text-edit-section.tsx` documents the rationale). Because these
properties are all already modeled, exposing them later is a pure
front-end change (flip `showStrikethrough`/`showHighlight`, add
super/subscript toggles) with no model or export work required. Note
that without a toolbar entry — and since the slides text-box editor does
not bind the docs engine's `Cmd+.`/`Cmd+,` shortcuts — super/subscript
is currently only reachable via PPTX import; the A1 export fix keeps
that content lossless on re-export.

### Phase B — universal typographic properties (shared model)

Extend the shared `InlineStyle`; Docs benefits too. Following the Phase
A decision, Phase B ships **functionality-first**: each item is model
field + shared renderer + slides import + slides export (+ tests), and
**toolbar UI is deferred** (see [Deferred: toolbar
exposure](#deferred-toolbar-exposure)). The slides text box persists
inline styles generically (the whole `blocks` Tree round-trips through
`yorkieToPlain`), so new fields save/collaborate without per-field store
code; docs field-by-field Yorkie persistence + docx + vector-PDF
(`pdf-painter.ts`) mapping are deferred until Docs authors these.
Every new field is added to `CLEAR_INLINE_STYLE` and both
`inlineStylesEqual` sites (the canonical one and the duplicate in
`text-editor.ts`) — the latter is run-merge-correctness critical.

- **`strikeStyle?: 'single' | 'double'`** (`@strike`
  `sngStrike`/`dblStrike`) — **shipped (B.1).** `strikethrough: true`
  with no style = single; double renders as two hairlines.
- **`caps?: 'all' | 'small'`** (`@cap`) — **deferred (B.3).** A correct
  implementation is more invasive than the other three: caps is a
  *display-only* attribute (Word/Docs copy the original case, not the
  rendered uppercase), so a `toUpperCase` on the shared segment text
  would corrupt copy/selection and can shift character offsets (e.g.
  `ß`→`SS`). Rendering it faithfully needs a separate `displayText` layer
  on `LayoutRun` used by measure + paint but not by copy/offset math, and
  `'small'` (small caps) additionally needs per-glyph size reduction. That
  layout-engine design is tracked as its own follow-up rather than bundled
  here.
- **`underlineStyle?`** (`'single' | 'double' | 'heavy' | 'dotted' |
  'dashed' | 'wavy'`) + **`underlineColor?: StoredColor`** — map the
  OOXML `@u` enum (17 values collapsed to this representative set) and
  `<a:uFill>`. `underline: true` with no style = single (today's
  behavior).
- **`letterSpacing?: number`** (points; negative = condensed) — map
  `@spc` (hundredths of a point in OOXML); affects measure + paint.

### Phase C — presentation text effects (Slides-side extension)

These do not belong in the Docs model. Add a Slides-side per-run
extension that reuses the existing shape fill/effects models.

- **Text gradient fill** (`<a:gradFill>`) — today only `<a:solidFill>`
  maps to `color`. Reuse the Slides `GradientFill` model
  ([slides-gradient-fill.md](slides-gradient-fill.md)).
- **Text outline** (`<a:ln>`).
- **Text effects** (`<a:effectLst>`: drop shadow / reflection / glow) —
  reuse the shape `effects` model
  ([slides-format-effects.md](slides-format-effects.md)).

### Phase D — round-trip fidelity

- **`fontFamilyEA?` / `fontFamilyCS?`** — store the East-Asian
  (`<a:ea>`) and complex-script (`<a:cs>`) typefaces separately instead
  of relying on the renderer's Noto fallback, so a PPTX authored with
  distinct CJK/Latin fonts round-trips its `<a:ea>` face. Render-time
  script detection picks the face per character run.

### Testing

Each phase adds PPTX round-trip coverage to the existing model-equivalence
verification the Slides PPTX exporter already runs over importer fixtures:
a run styled with the new property, exported, re-imported, and asserted
equal at the model level. Phase A additionally asserts the specific
regressions it fixes (super/subscript and hyperlink survive a round
trip). UI wiring is covered by the frontend component tests.

### Risks and Mitigation

- **Shared-model churn affecting Docs.** Adding fields to `InlineStyle`
  changes a type Docs also consumes. Mitigation: every field is
  optional and additive; the Docs renderer already ignores unknown
  style keys, so an unhandled field renders as its default rather than
  breaking. Docs opts into new UI controls separately.
- **Reversing a deliberate UI omission.** The Slides toolbar hid
  strikethrough/highlight on purpose (documented in the section
  header). Reversing it is intentional here (OOXML parity is now the
  goal); the rationale comments are updated so the history is clear.
- **Hyperlink relationship plumbing.** Threading a rel-adder through the
  text chain is the one non-trivial Phase A change; isolating it in A2
  keeps A1 a low-risk pure-UI/export PR.
- **Underline enum breadth.** OOXML's 17 underline values don't all map
  to distinct Canvas renderings. We collapse to a representative set and
  preserve the original only as best-effort; unmapped values fall back
  to single underline rather than dropping the underline entirely.
