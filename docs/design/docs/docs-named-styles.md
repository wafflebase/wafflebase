---
title: docs-named-styles
target-version: 0.4.9
---

# Docs Named Styles

## Summary

Promote the docs word processor's hardcoded heading/title/subtitle style
defaults into a **document-scoped, redefinable style registry** that matches
Google Docs' "Paragraph styles" model. The fixed catalog (Normal text, Title,
Subtitle, Heading 1–6) stays — users cannot invent arbitrary named styles
(Google Docs parity) — but each style's *definition* becomes editable per
document via "Update '<style>' to match" and resettable via "Reset styles".
A per-user "default styles" blob (Save / Use my default styles) is persisted
in the backend so a user's redefinitions carry across documents.

This also refreshes the built-in style values to Google Docs defaults
(non-bold headings, grayscale color hierarchy, paragraph spacing).

Roadmap item: Phase **6.5 Named Styles** in
[docs-wordprocessor-roadmap.md](docs-wordprocessor-roadmap.md).

## Goals / Non-Goals

**Goals**

- A document-level style registry stored in the Yorkie CRDT (root level,
  beside `pageSetup`) holding **only overrides** of built-in style defs.
- "Update '<style>' to match" — redefine a style from the caret block's
  current formatting; all blocks of that style reflow.
- "Reset '<style>'" and "Reset styles" — drop overrides back to built-ins.
- Refine built-in Title/Subtitle/Heading 1–6 values to Google Docs defaults.
- Expose Heading 4–6 in the Styles dropdown (currently H1–3 only).
- Per-user default styles persisted in backend ("Save / Use my default
  styles").

**Non-Goals**

- Arbitrary user-named custom styles (Word model). Out of scope by design.
- Character-level cascade for *direct* formatting tracking (Google Docs'
  "clear formatting reverts to style") beyond what already exists.
- Changing the **Normal** text body defaults (line spacing 1.5, margins) —
  kept as-is to avoid reflowing every existing document. Documented deviation
  from Google Docs (which uses 1.15).

## Proposal Details

### Style catalog & block reference

Nine styles keyed by a stable `StyleId`:

```ts
type StyleId =
  | 'normal' | 'title' | 'subtitle'
  | 'heading-1' | 'heading-2' | 'heading-3'
  | 'heading-4' | 'heading-5' | 'heading-6';
```

A block's reference to its style is **derived from existing fields** — no block
model change, full backward compatibility:

| Block | StyleId |
| --- | --- |
| `paragraph`, `list-item` | `normal` |
| `title` | `title` |
| `subtitle` | `subtitle` |
| `heading` + `headingLevel: N` | `heading-N` |
| `horizontal-rule`, `table`, `page-break` | `normal` (no style applied) |

`blockStyleId(block): StyleId` lives in `model/named-styles.ts`.

### Data model

```ts
interface NamedStyleDef {
  inline: Partial<InlineStyle>;   // bold, italic, fontSize, fontFamily, color
  block: Partial<BlockStyle>;     // spacing only: marginTop, marginBottom, lineHeight
}

// Document registry — overrides only; an empty/absent entry means "built-in".
type DocStyles = Partial<Record<StyleId, Partial<NamedStyleDef>>>;
```

`BUILTIN_STYLES: Record<StyleId, NamedStyleDef>` holds the refreshed defaults
below. Resolution deep-merges override over built-in:

```ts
resolveStyleInline(id, docStyles) = { ...BUILTIN_STYLES[id].inline, ...docStyles?.[id]?.inline }
resolveStyleBlock(id, docStyles)  = { ...BUILTIN_STYLES[id].block,  ...docStyles?.[id]?.block }
```

`Document` gains an optional `styles?: DocStyles` field, beside `pageSetup`.

### Built-in values (Google Docs defaults)

Font = Arial. Heading spacing converted pt→px at 96 dpi (`px = pt × 4/3`,
rounded). Headings are **non-bold**; weight comes from size + grayscale color.

| Style | size | weight | color | space-above / below (px) |
| --- | --- | --- | --- | --- |
| Normal | 11 | — | #000000 | (unchanged: marginBottom 8) |
| Title | 26 | — | #000000 | 0 / 4 |
| Subtitle | 15 | — | #666666 | 0 / 16 |
| Heading 1 | 20 | — | #000000 | 27 / 8 |
| Heading 2 | 16 | — | #000000 | 24 / 8 |
| Heading 3 | 14 | — | #434343 | 21 / 5 |
| Heading 4 | 12 | — | #666666 | 19 / 5 |
| Heading 5 | 11 | — | #666666 | 16 / 5 |
| Heading 6 | 11 | italic | #666666 | 16 / 5 |

> Exact values re-verified against a live Google Docs DOCX export during
> implementation. This is a visible change from the current bold/larger
> headings — called out in the PR description as intentional.

### Cascade resolution model

Two distinct paths, mirroring the existing architecture:

- **Inline (font / size / bold / italic / color) — lazy, registry-driven.**
  `resolveBlockInlines(block, docStyles?)` uses
  `resolveStyleInline(blockStyleId(block), docStyles)` as the base layer under
  each inline's explicit style (replaces the hardcoded
  `getHeadingDefaults` / `TITLE_DEFAULTS` / `SUBTITLE_DEFAULTS` constants).
  Threaded through `computeLayout(..., docStyles?)` → `layoutBlock(..., docStyles?)`.
  Default (no arg) = built-in resolution, so slides text-box editor, PDF
  exporter, and CLI keep working unchanged; the docs editor and PDF exporter
  pass `document.styles`. Result: "Update to match" reflows every block of the
  style instantly with **no block rewrites**.

- **Block spacing (marginTop / marginBottom / lineHeight) — eager, materialized.**
  `block.style` stays full-value and authoritative for layout (no layout
  change for spacing). The style's block defaults are written into
  `block.style` at the moment of:
  - **apply** (`setBlockType`) — when the *previous* and *next* `StyleId`
    differ, re-materialize spacing (paragraph↔list-item, both `normal`, is a
    no-op, so a bullet toggle never disturbs spacing);
  - **update** (`updateStyleDefinition`) — re-materialize spacing for every
    block whose `blockStyleId === styleId`;
  - **reset** — re-materialize to built-in spacing.

  Direct per-paragraph spacing edits remain on `block.style` and are treated as
  direct formatting (Google Docs parity).

### Store API (`DocStore`)

```ts
getDocStyles(): DocStyles;
setDocStyles(styles: DocStyles): void;
updateStyleDefinition(styleId: StyleId, def: NamedStyleDef): void; // "Update to match"
resetStyle(styleId: StyleId): void;                                // "Reset this style"
resetAllStyles(): void;                                            // "Reset styles"
```

`updateStyleDefinition` / `resetStyle` / `resetAllStyles` each run as one
batched undo unit and re-materialize block spacing for affected blocks.
Implemented in `MemStore` (plain `this.doc.styles`) and `YorkieDocStore`
(root-level `root.styles`, mirroring the `pageSetup` getter/setter +
`readDocStyles` proxy-unwrap helper). Backend `docs-tree.ts` `DocsYorkieRoot`
serializes `styles` the same way (deep copy on write, delete on omission).

### Per-user default styles (backend)

New Prisma model + migration:

```prisma
model UserDocStyles {
  userId    Int      @id
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  styles    Json
  updatedAt DateTime @updatedAt
}
```

Endpoints (JWT, `@CurrentUser`-style like `auth.controller.ts` `getMe`):

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/auth/me/doc-styles` | Return saved `DocStyles` (or `{}`) |
| `PUT` | `/auth/me/doc-styles` | Upsert the current user's `DocStyles` |

Frontend wires these into the Styles dropdown "Options" submenu:
- **Save as my default styles** → `PUT` current `getDocStyles()`.
- **Use my default styles** → `GET`, then `setDocStyles(...)`.

### UI (`text-style-group.tsx` / `text-style-options.ts`)

- Add **Heading 4 / 5 / 6** rows (shortcuts ⌥4–⌥6).
- Each style row gains a hover submenu (▸): *Apply* /
  *Update '<style>' to match* (reads the caret block's effective formatting via
  the same resolution used by the toolbar) / *Reset '<style>'*.
- Bottom **Options** entry: *Save as my default styles* / *Use my default
  styles* / *Reset styles* — mirrors Google Docs' Format → Paragraph styles.

The docs formatting toolbar (`docs-formatting-toolbar.tsx`) wires the new
callbacks to `EditorAPI` primitives that call the store methods above.

## Risks and Mitigation

- **Heading appearance change** (bold→non-bold, new colors) is visible on every
  existing document. *Mitigation:* intentional Google Docs parity; called out
  in the PR; built-in-only — no data migration, and a user who preferred bold
  can "Update Heading 1 to match" a bold sample.
- **Registry not understood by older clients / backend.** *Mitigation:*
  `styles` is optional and additive at the Yorkie root, exactly like
  `pageSetup`; absence resolves to built-ins.
- **Eager spacing materialization clobbers custom paragraph spacing on style
  switch.** *Mitigation:* only re-materialize when `StyleId` actually changes;
  this matches Google Docs (applying a style resets paragraph formatting).
- **Threading `docStyles` through layout** touches a hot path. *Mitigation:*
  optional param defaulting to built-in; only the docs editor + PDF export pass
  it; covered by layout unit tests asserting registry override wins.
