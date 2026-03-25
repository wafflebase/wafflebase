# Docs Phase 2: Inline Extensions & Clipboard

## Summary

Phase 2 extends the Docs word processor with inline formatting (superscript,
subscript, hyperlinks), clipboard operations (rich copy/paste, format painting),
and find & replace. Features are implemented sequentially in order of increasing
complexity.

### Implementation Order

1. Superscript / Subscript
2. Hyperlink
3. Clipboard
4. Find & Replace

### Goals

- Extend InlineStyle with `superscript`, `subscript`, and `href` fields
- Rich internal copy/paste with JSON serialization; external HTML paste with
  basic inline conversion
- Document-wide find & replace with match highlighting
- Google Docs-compatible shortcuts and UX

### Non-Goals

- Block-level HTML paste conversion (headings, lists from external HTML)
- Syntax highlighting in code blocks (Phase 3)
- Regex builder UI for find & replace

---

## 1. Superscript / Subscript

### Data Model

Add to `InlineStyle` in `packages/docs/src/model/types.ts`:

```typescript
interface InlineStyle {
  // ...existing fields...
  superscript?: boolean;
  subscript?: boolean;
}
```

Mutual exclusion: applying superscript clears subscript, and vice versa.

### Rendering

- Font size: 60% of the current font size for the run
- Superscript baseline offset: shift up by ~40% of the original font size
- Subscript baseline offset: shift down by ~20% of the original font size
- Applied per-run in `doc-canvas.ts` text rendering loop

### Layout

- `layout.ts` uses the reduced font size for `measureText` width calculation
- Line height computation accounts for the vertical offset so lines with
  superscript/subscript do not clip

### Shortcuts & Toolbar

| Shortcut | Action |
|----------|--------|
| `Cmd+.` | Toggle superscript |
| `Cmd+,` | Toggle subscript |

Toolbar: toggle buttons for superscript (x^2 icon) and subscript (x_2 icon).

### Yorkie Serialization

Store `superscript` and `subscript` as Tree node attributes. Missing attributes
default to `undefined` (backward compatible).

---

## 2. Hyperlink

### Data Model

Add to `InlineStyle`:

```typescript
interface InlineStyle {
  // ...existing fields...
  href?: string;
}
```

When `href` is present, the inline is treated as a link.

### Rendering

- Link text color: `#1155cc` (blue), underline auto-applied
- If the user explicitly sets color or underline, user values take precedence

### Mouse Interaction

- **Hover**: show popover overlay (DOM element positioned over Canvas) with:
  - URL text (truncated if long)
  - "Open" button — opens URL in new tab
  - "Edit" button — opens Ctrl+K dialog pre-filled
  - "Remove" button — clears `href` from the link inlines
- **Ctrl+Click**: open URL in new tab (`window.open`)
- **Normal click**: position cursor (editing mode)

### Ctrl+K Dialog

- Triggered by `Cmd/Ctrl+K` shortcut
- Input field: URL
- If text is selected, that text becomes the link display text
- If no selection, the URL is used as display text
- If cursor is inside an existing link, dialog opens in edit mode with
  current URL pre-filled

### URL Auto-Detection

- When user types a URL starting with `http://` or `https://` followed by
  Space or Enter, the preceding URL text is automatically converted to a link
- Detection scans backward from the Space/Enter position to find the URL start

### Popover Implementation

- DOM overlay element positioned using Canvas-to-screen coordinate conversion
- Dismissed on: click outside, scroll, cursor move to non-link position
- Same coordinate system as ruler / toolbar overlays

### Yorkie Serialization

Store `href` as a Tree node attribute. Missing attribute defaults to
`undefined`.

---

## 3. Clipboard

### Internal Copy/Paste (JSON)

- **Copy/Cut**: serialize selected blocks and inlines as JSON, store under
  `application/x-waffledocs` MIME type in the system clipboard
- Simultaneously store `text/plain` for external app compatibility
- **Paste**: if `application/x-waffledocs` is present, deserialize JSON and
  insert with full formatting preserved

### External HTML Paste

Parse `text/html` MIME type with basic inline conversion only:

| HTML | InlineStyle |
|------|-------------|
| `<b>`, `<strong>` | `bold: true` |
| `<i>`, `<em>` | `italic: true` |
| `<u>` | `underline: true` |
| `<s>`, `<del>`, `<strike>` | `strikethrough: true` |
| `style="color: ..."` | `color` |
| `style="font-size: ..."` | `fontSize` |
| `style="background-color: ..."` | `backgroundColor` |

Unrecognized tags fall back to plain text extraction.

### Plain-Text Paste

- `Cmd+Shift+V`: paste as plain text, stripping all formatting
- Inherits the InlineStyle at the current cursor position

### Copy Formatting (Format Painter)

- `Cmd+Shift+C`: copy the InlineStyle at current selection/cursor to an
  in-memory style buffer (not system clipboard)
- `Cmd+Alt+V`: apply the buffered style to the current selection
- Style buffer persists in memory until overwritten or editor is destroyed

### Cut

Same as copy but deletes the selected range after storing JSON + plain text.

---

## 4. Find & Replace

### Search Engine

Add to `Doc` class in `packages/docs/src/model/document.ts`:

```typescript
interface SearchOptions {
  caseSensitive?: boolean;
  useRegex?: boolean;
}

interface SearchMatch {
  blockId: string;
  startOffset: number;
  endOffset: number;
}

searchText(query: string, options?: SearchOptions): SearchMatch[]
```

Search concatenates inline text within each block and finds all matches.
Matches can span inline boundaries but not block boundaries.

### UI (Top Bar)

- `Cmd+F`: show search bar at document top (DOM overlay)
  - Text input + previous/next buttons + match count display (e.g., "3 of 12")
- `Cmd+H`: show search bar + replace field
- `Escape`: close the bar
- Input is a standard DOM text field (not Canvas-rendered)

### Match Highlighting

- All matches: yellow background highlight (`#fff2a8`)
- Active match (currently selected): orange background (`#f4a939`)
- Rendered as background rectangles in Canvas, similar to selection rendering

### Navigation

- Enter / Next button: advance to next match (wraps around)
- Shift+Enter / Prev button: go to previous match
- Auto-scroll to bring the active match into viewport

### Replace

- "Replace" button: replace the current active match only
- "Replace All" button: replace all matches at once
- Replace All is a single undo unit

### Options

- Case-sensitive toggle (default: off)
- Regex toggle (default: off)

---

## Key Files

| File | Changes |
|------|---------|
| `packages/docs/src/model/types.ts` | Add `superscript`, `subscript`, `href` to InlineStyle |
| `packages/docs/src/model/document.ts` | Add `searchText()` method; mutual exclusion logic for super/subscript |
| `packages/docs/src/view/doc-canvas.ts` | Render links (blue/underline), super/subscript (baseline shift), search highlights |
| `packages/docs/src/view/layout.ts` | Account for reduced font size and baseline offset in line measurement |
| `packages/docs/src/view/text-editor.ts` | Add shortcuts (Cmd+., Cmd+,, Cmd+K, Cmd+F, Cmd+H, Cmd+Shift+V); extend paste handler for HTML/JSON |
| `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx` | Add superscript/subscript/link toolbar buttons |
| `packages/frontend/src/app/docs/yorkie-doc-store.ts` | Serialize new InlineStyle fields as Tree attributes |

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Superscript/subscript baseline shift clips line boundary | Add offset to line height calculation |
| Link popover positioning off-screen | Clamp popover to viewport bounds |
| External HTML paste produces unexpected formatting | Parse only allowlisted tags; fallback to plain text |
| Find & Replace on large documents is slow | Search per-block (no cross-block matching), lazy re-search on document change |
| System clipboard MIME type support varies by browser | Feature-detect `application/x-waffledocs`; fallback to plain text |
