---
title: docs-header-footer
target-version: 0.3.2
---

# Document Header & Footer

## Summary

Add editable header and footer regions to the paginated document editor.
Headers and footers are rendered in the page margin area (above/below the
content area) and share the same Block/Inline data model as the document body.
A special `pageNumber` inline token is replaced with the actual page number
during rendering. Users enter header/footer editing via double-click on the
margin area; the editor maintains an `EditContext` that routes all input to the
active block array.

### Goals

- Editable header and footer using the existing Block/Inline model.
- Page number insertion via a special inline token.
- Header/footer rendered in the margin area on every page.
- Double-click to enter header/footer editing, click body or Escape to exit.
- Yorkie serialization with backward compatibility.

### Non-Goals

- "First page different" or "odd/even page different" headers — future extension.
- Section breaks with per-section headers — depends on Phase 4.3.
- Header/footer UI in a modal or side panel — editing is inline on the page.
- Page count token (`{PAGES}`) — only current page number for now.

## Data Model

### Document Extension

```typescript
interface Document {
  blocks: Block[];
  pageSetup?: PageSetup;
  header?: HeaderFooter;   // undefined = no header
  footer?: HeaderFooter;   // undefined = no footer
}

interface HeaderFooter {
  blocks: Block[];          // reuses existing Block/Inline model
  marginFromEdge: number;   // distance from page edge in px (default 48 = 0.5 inch)
}
```

When `header` or `footer` is `undefined`, the margin area is empty and
double-clicking it creates a new `HeaderFooter` with a single empty paragraph.

### Default Values

- `marginFromEdge`: 48px (0.5 inch at 96 DPI) — matches Google Docs.
- Initial blocks: one empty paragraph block.

### Page Number Inline

Extend `InlineStyle` with a `pageNumber` flag:

```typescript
interface InlineStyle {
  // ... existing fields
  pageNumber?: boolean;
}
```

An inline with `pageNumber: true` stores placeholder text `"#"` in the model.
During rendering, the text is replaced with the current page number string
(`"1"`, `"2"`, ...). All other style properties (bold, italic, fontSize, color,
alignment) apply normally.

### Blocked Block Types

Header/footer blocks must not contain: `table`, `page-break`,
`horizontal-rule`. The editor prevents creation of these types when
`editContext` is `'header'` or `'footer'`. `heading`, `list-item`, and
`paragraph` are allowed.

## Layout

### Header/Footer Layout

`computeLayout(blocks, ctx, contentWidth)` is reused for header and footer
blocks. The `contentWidth` is the same as the body content width
(`pageWidth - margins.left - margins.right`).

Header and footer layouts are computed once and reused for all pages (single
header/footer model).

### Pipeline

```
headerLayout = header ? computeLayout(header.blocks, ctx, contentWidth) : null
footerLayout = footer ? computeLayout(footer.blocks, ctx, contentWidth) : null
bodyLayout   = computeLayout(doc.blocks, ctx, contentWidth)
paginated    = paginateLayout(bodyLayout, pageSetup)
```

The body pagination is unchanged — `contentHeight` remains
`pageHeight - margins.top - margins.bottom`. Header/footer content lives in
the margin area and does not affect body pagination.

### Vertical Positioning

Per page, absolute Y coordinates:

- **Header start**: `pageY + header.marginFromEdge`
- **Footer start**: `pageY + pageHeight - footer.marginFromEdge - footerLayout.totalHeight`

Horizontal offset: `pageX + margins.left` (same as body content).

### Page Number Text Measurement

During layout, `pageNumber` inlines use the placeholder `"#"` for width
measurement. The width difference between `"#"` and actual numbers (e.g. `"12"`)
is negligible for typical documents. No re-layout per page is needed.

## Rendering

### Render Order (doc-canvas.ts)

Extended page render loop:

```
for each page:
  1. Viewport culling
  2. Draw shadow + page background
  3. [NEW] Clip header area → draw header runs
  4. [NEW] Clip footer area → draw footer runs
  5. Clip content area → draw selections, text, cursor (existing)
  6. Draw peer cursors (existing)
```

### Header/Footer Clipping

- **Header clip rect**: `(pageX + margins.left, pageY + marginFromEdge, contentWidth, margins.top - marginFromEdge)`
- **Footer clip rect**: `(pageX + margins.left, pageY + pageHeight - margins.bottom, contentWidth, margins.bottom - marginFromEdge)`

### Page Number Rendering

`renderRun()` is reused. When processing a run with `pageNumber: true`, the
renderer substitutes `run.text` with the current page's number string before
calling `fillText`. Style properties (font, color, size) apply normally.

### Edit Mode Visual Feedback

When `editContext` is `'header'` or `'footer'`:

- Active region: dashed border outline (`#ccc`, 1px).
- Body content: reduced opacity (e.g. `globalAlpha = 0.4`) to visually
  distinguish the editing context.
- Inactive header/footer: rendered normally (no dimming).

## Editing Model

### Edit Context

```typescript
type EditContext = 'body' | 'header' | 'footer';
```

TextEditor gains an `editContext` field (default `'body'`).

### Context Switching

- **Double-click on header margin area** → set `editContext = 'header'`, create
  `HeaderFooter` if undefined, place cursor.
- **Double-click on footer margin area** → set `editContext = 'footer'`, create
  `HeaderFooter` if undefined, place cursor.
- **Single-click on body area** or **Escape** → set `editContext = 'body'`.
- **Single-click on header/footer area** while already in that context → move
  cursor within the region.

### Active Block Array

All editing operations (input, delete, format, split, merge) operate on the
active block array:

```typescript
getActiveBlocks(): Block[] {
  if (editContext === 'header') return doc.header.blocks;
  if (editContext === 'footer') return doc.footer.blocks;
  return doc.blocks;
}
```

The `Doc` (document model) methods accept block arrays or the editor routes
calls to the correct block array.

### Disabled Operations in Header/Footer

- `Ctrl+Enter` (page break): ignored.
- Block type changes to `table`, `page-break`, `horizontal-rule`: blocked.
- Find & Replace: searches body only (header/footer excluded for simplicity).

## Coordinate Mapping

### Click Target Resolution

Extend pixel-to-position mapping to return a `ClickTarget`:

```typescript
interface ClickTarget {
  context: EditContext;
  position: DocPosition;
}
```

Per-page hit testing (using click Y relative to page top):

| Y range | Target |
|---------|--------|
| `marginFromEdge` to `margins.top` | header |
| `margins.top` to `pageHeight - margins.bottom` | body |
| `pageHeight - margins.bottom` to `pageHeight - marginFromEdge` | footer |

Clicks in the outer edge zone (0 to `marginFromEdge`, or
`pageHeight - marginFromEdge` to `pageHeight`) map to the nearest region.

### Cursor Position (positionToPixel)

When `editContext` is `'header'` or `'footer'`, cursor pixel position is
computed from the header/footer layout:

- **Header**: `pageY + marginFromEdge + lineY`
- **Footer**: `pageY + pageHeight - marginFromEdge - footerHeight + lineY`

The cursor is shown on the page closest to the current viewport center (since
all pages share the same header/footer content).

## Store

### DocStore Extension

```typescript
interface DocStore {
  // ... existing
  getHeader(): HeaderFooter | undefined;
  getFooter(): HeaderFooter | undefined;
  setHeader(header: HeaderFooter | undefined): void;
  setFooter(footer: HeaderFooter | undefined): void;
}
```

`setHeader`/`setFooter` push to the undo stack. Setting `undefined` removes
the header/footer.

### MemDocStore

Implements the new methods by reading/writing `document.header` and
`document.footer`.

## Yorkie Serialization

### Tree Structure

Header and footer are stored as optional container nodes under the Tree root:

```
root
├── header          (optional)
│   └── block[type=paragraph]
│       └── inline[style=...]
│           └── text
├── footer          (optional)
│   └── block[type=paragraph]
│       └── inline[style=...]
│           └── text
└── body
    └── block[type=paragraph]
        └── ...
```

### Header/Footer Attributes

Container node attributes:

```typescript
{ type: 'header', marginFromEdge: '48' }
{ type: 'footer', marginFromEdge: '48' }
```

### Page Number Serialization

Inline style attribute: `pageNumber: 'true'`. Text content: `#`.

### Backward Compatibility

Existing documents without `header`/`footer` nodes deserialize to
`undefined` — no migration needed. The absence of these nodes is the default
state (no header/footer).

## File Change Summary

| File | Change |
|------|--------|
| `model/types.ts` | `HeaderFooter` interface, `Document.header/footer`, `InlineStyle.pageNumber` |
| `model/document.ts` | Block operations routed by context, page-number inline creation |
| `view/layout.ts` | No change (reused as-is for header/footer blocks) |
| `view/pagination.ts` | Export header/footer Y offset helpers |
| `view/doc-canvas.ts` | Render header/footer per page, page-number substitution, edit-mode visuals |
| `view/text-editor.ts` | `EditContext`, context switching, double-click handling, operation routing |
| `view/theme.ts` | Header/footer edit-mode visual constants (dashed border, dimming alpha) |
| `store/store.ts` | `getHeader/Footer()`, `setHeader/Footer()` |
| `store/memory.ts` | MemDocStore implementation |
| `frontend/.../yorkie-doc-store.ts` | Yorkie serialization/deserialization for header/footer nodes |

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| EditContext routing complexity in TextEditor | TextEditor already handles table cell editing context; header/footer follows the same pattern |
| Page number width mismatch between layout and render | Placeholder `#` width is close to digit width; acceptable for v1 |
| Undo/redo across context switches | Each context's mutations are separate undo entries; context switch itself is not undoable |
| Yorkie Tree structure change | Additive change (new optional nodes); no migration needed |
| Header/footer overflow beyond margin area | Clip rect prevents visual overflow; content simply gets cut off |
