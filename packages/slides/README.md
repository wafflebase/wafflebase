# @wafflebase/slides

Canvas-based presentation engine for Wafflebase. Provides free-position
slides (text boxes, shapes, images), a four-tier theme/master/layout
model, a Canvas + DOM-overlay editor, and a store abstraction for
persistence. Pure domain library — no Yorkie, React, or DOM dependencies
in the package itself; the Yorkie adapter and React shell live in
`packages/frontend/src/app/slides/`.

## Architecture

```
┌─────────────────┐ ┌─────────────────┐ ┌────────────────┐
│     Editor      │ │    Renderer     │ │     Store      │
│ ┌─────────────┐ │ │ ┌─────────────┐ │ │ ┌────────────┐ │
│ │ initialize()│ │ │ │ SlideRender │ │ │ │ Snapshot   │ │
│ │ Selection   │ │ │ │ Element     │ │ │ │ Undo/Redo  │ │
│ └─────────────┘ │ │ │ Shape/Text  │ │ │ │ Batch      │ │
│                 │ │ │ Image       │ │ │ └────────────┘ │
│ ┌─────────────┐ │ │ └─────────────┘ │ └────────────────┘
│ │ Interactions│ │ │ ┌─────────────┐ │ ┌────────────────┐
│ │ drag/resize │ │ │ │ Theme       │ │ │   Slide Model  │
│ │ insert/lasso│ │ │ │ resolveColor│ │ │ ┌────────────┐ │
│ └─────────────┘ │ │ │ resolveFont │ │ │ │ Slide →    │ │
│                 │ │ └─────────────┘ │ │ │  Element   │ │
│ ┌─────────────┐ │ │ ┌─────────────┐ │ │ │  (text /   │ │
│ │ Thumbnails  │ │ │ │ Thumbnails  │ │ │ │   shape /  │ │
│ │ Notes panel │ │ │ │ Scheduler   │ │ │ │   image)   │ │
│ └─────────────┘ │ │ └─────────────┘ │ │ └────────────┘ │
└─────────────────┘ └─────────────────┘ └────────────────┘
```

- **Editor** — Top-level entry point. `initializeEditor(container, store, options)` mounts the Canvas + DOM overlay and wires drag/resize/lasso/insert interactions.
- **Renderer** — `SlideRenderer.render(slide, doc)` paints a slide to a Canvas 2D context. Every `ctx.fillStyle` / `ctx.strokeStyle` routes through `resolveColor(themeColor, theme)` so role-bound colors follow the deck's active theme. Text rendering delegates to `@wafflebase/docs`'s layout/paint pipeline.
- **Store** — `SlidesStore` interface decouples the engine from persistence. `MemSlidesStore` provides snapshot-based undo/redo with batch grouping. `YorkieSlidesStore` (in the frontend package) adds real-time collaboration.
- **Slide Model** — `SlidesDocument → Theme/Master/Layout/Slide → Element` hierarchy. Slides are free-position canvases; elements are text boxes (rich text via `@wafflebase/docs`), shapes (rect / ellipse / line / arrow), or images.

## Key Concepts

| Concept | Description |
|---------|-------------|
| `SlidesDocument` | Root model — `meta`, `themes[]`, `masters[]`, `layouts[]`, `slides[]` |
| `Theme` | `ColorScheme` (12 role slots) + `FontScheme` (heading + body) |
| `Master` | Theme-bound default placeholder styles for the deck |
| `Layout` | Named placeholder geometry (Title slide, Section header, Big number, etc.); 11 Google-Slides-parity built-ins |
| `Slide` | Picks one `layoutId`, owns its own `elements[]`, `background`, `notes` |
| `Element` | `TextElement` \| `ShapeElement` \| `ImageElement` — all carry an `id` and a `Frame` (x/y/w/h/rotation) |
| `ThemeColor` | `{ kind: 'role', role, tint?, shade? }` \| `{ kind: 'srgb', value }` — hybrid binding so role colors follow theme switches |
| `ThemeFont` | `{ kind: 'role', role: 'heading' \| 'body' }` \| `{ kind: 'family', family }` |
| `Frame` | `{ x, y, w, h, rotation }` — logical 1920×1080 coordinates |

## Public API

Exports from `src/index.ts`:

```typescript
// Model
type SlidesDocument, Slide, Layout, Background, Meta, PlaceholderSpec
type Theme, ColorScheme, FontScheme, ColorRole, FontRole, ThemeColor, ThemeFont
type Master, PlaceholderStyle, MasterBackground
type Element, TextElement, ShapeElement, ImageElement, ElementInit, Frame
DEFAULT_BACKGROUND, DEFAULT_MASTER, SLIDE_WIDTH, SLIDE_HEIGHT
resolveColor, resolveFont, generateId

// Layouts (11 built-in)
BUILT_IN_LAYOUTS, getLayout

// Themes (5 built-in)
BUILT_IN_THEMES, getBuiltInTheme
defaultLight, defaultDark, streamline, focus, material

// Migration
migrateDocument

// Store
type SlidesStore
MemSlidesStore

// Renderer
SlideRenderer, type SlideRendererOptions
drawElement, drawShape, drawText, drawImage
renderThumbnail, ThumbnailScheduler

// Editor
initializeEditor, type SlidesEditor, type SlidesEditorOptions, type InsertKind
mountThumbnailPanel, mountNotesPanel
showContextMenu, type ContextMenuItem

// Clipboard
SLIDES_CLIPBOARD_MIME, serializeElements, deserializeElements
```

## Usage

```typescript
import {
  initializeEditor,
  MemSlidesStore,
  BUILT_IN_LAYOUTS,
  BUILT_IN_THEMES,
  DEFAULT_MASTER,
  defaultLight,
} from '@wafflebase/slides';

// 1. Build a SlidesDocument (or load one from your store)
const store = new MemSlidesStore();
store.batch(() => store.addSlide('title-slide'));

// 2. Mount the editor on a container
const container = document.getElementById('slides-editor')!;
const editor = initializeEditor(container, { store });

// 3. Switch the active theme — every role-bound element repaints
store.batch(() => {
  store.addTheme(defaultLight); // idempotent
  store.applyTheme('default-light');
});

editor.dispose(); // Clean up
```

## Development

```bash
pnpm install                                  # Install dependencies (from monorepo root)
pnpm --filter @wafflebase/slides test         # Run unit tests (Vitest)
pnpm --filter @wafflebase/slides test:watch   # Watch mode
pnpm --filter @wafflebase/slides build        # Library build (ESM + CJS + .d.ts)
pnpm --filter @wafflebase/slides typecheck    # TypeScript check
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (ES2020, strict) |
| Rendering | HTML5 Canvas + DOM overlay |
| Rich text | `@wafflebase/docs` (text-box layout / paint reuses the docs engine) |
| Build | Vite (library mode) |
| Tests | Vitest + jsdom |

## Further Reading

- [slides.md](../../docs/design/slides/slides.md) — Full design document (v1 MVP: data model, Yorkie schema, Canvas+DOM editor, two-pane layout, PDF export)
- [slides-themes-layouts-import.md](../../docs/design/slides/slides-themes-layouts-import.md) — Theme/Master/Layout 4-tier model, hybrid color binding, eleven built-in layouts, PPTX best-effort import
