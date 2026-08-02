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

- **Editor** — Top-level entry point. `initializeEditor(options)` — a single `SlidesEditorOptions` object (`{ canvas, overlay, store, … }`) — mounts the Canvas + DOM overlay and wires drag/resize/lasso/insert interactions.
- **Renderer** — `SlideRenderer.render(slide, doc)` paints a slide to a Canvas 2D context. Every `ctx.fillStyle` / `ctx.strokeStyle` routes through `resolveColor(themeColor, theme)` so role-bound colors follow the deck's active theme. Text rendering delegates to `@wafflebase/docs`'s layout/paint pipeline.
- **Store** — `SlidesStore` interface decouples the engine from persistence. `MemSlidesStore` provides snapshot-based undo/redo with batch grouping. `YorkieSlidesStore` (in the frontend package) adds real-time collaboration and drives undo/redo through Yorkie `doc.history` (one `batch()` = one undo unit — see [slides-native-undo.md](../../docs/design/slides/slides-native-undo.md)).
- **Slide Model** — `SlidesDocument → Theme/Master/Layout/Slide → Element` hierarchy. Slides are free-position canvases; elements are text boxes (rich text via `@wafflebase/docs`), shapes (55+ OOXML presets), connectors, groups, tables, charts, and images.

## Key Concepts

| Concept | Description |
|---------|-------------|
| `SlidesDocument` | Root model — `meta`, `themes[]`, `masters[]`, `layouts[]`, `slides[]` |
| `Theme` | `ColorScheme` (12 role slots) + `FontScheme` (heading + body) |
| `Master` | Theme-bound default placeholder styles for the deck |
| `Layout` | Named placeholder geometry (Title slide, Section header, Big number, etc.); 11 Google-Slides-parity built-ins |
| `Slide` | Picks one `layoutId`, owns its own `elements[]`, `background`, `notes` |
| `Element` | `TextElement` \| `ShapeElement` \| `ImageElement` \| `ConnectorElement` \| `GroupElement` \| `TableElement` \| `ChartElement` — all carry an `id` and a `Frame` (x/y/w/h/rotation). (`ChartElement` is part of the union but is not yet re-exported from the package root — charts render from imported PPTX but have no public editing API.) |
| Image crop | `ImageElement.data.crop` is a normalized `0..1` source rect. Edit it interactively via `editor.enterImageCrop(id)` (double-click an image) — drag the black handles to trim, drag to pan, Enter/click-out commits, Esc cancels. `resetImageCrop(id)` clears it and restores proportions. P0 = rectangular; crop-to-shape is P1. See [docs/design/slides/slides-image-crop.md](../../docs/design/slides/slides-image-crop.md) |
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
type ConnectorElement, GroupElement, TableElement, ShapeKind
DEFAULT_BACKGROUND, DEFAULT_MASTER, SLIDE_WIDTH, SLIDE_HEIGHT
resolveColor, resolveFont, generateId

// Layouts (11 built-in)
BUILT_IN_LAYOUTS, getLayout

// Themes — BUILT_IN_THEMES holds the 23-theme GS-parity catalog;
// a handful also have individual named exports
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
worldToScreen, screenToWorld            // viewport transforms

// Editor
initializeEditor, type SlidesEditor, type SlidesEditorOptions, type InsertKind
mountThumbnailPanel, mountNotesPanel
showContextMenu, type ContextMenuItem
LayoutEditStore                          // in-canvas layout/master editing

// Animation engine
export * from './anim'                   // timeline + player shared by editor Play + presentation mode

// Import / export
importPptx, exportPptx                   // PPTX round-trip
exportSlidesPdf                          // raster PDF export

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

// 2. Mount the editor on a canvas + DOM overlay
const canvas = document.getElementById('slides-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('slides-overlay') as HTMLDivElement;
const editor = initializeEditor({ canvas, overlay, store });

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

- [slides.md](../../docs/design/slides/slides.md) — Full design document (data model, Yorkie schema, Canvas+DOM editor, two-pane layout, PDF export)
- [slides-themes-layouts-import.md](../../docs/design/slides/slides-themes-layouts-import.md) — Theme/Master/Layout 4-tier model, hybrid color binding, eleven built-in layouts, PPTX best-effort import

The full set of per-feature slides design docs (animation, tables, charts,
connectors, groups, gradient fill/editing, PPTX import/export, presentation
mode, mobile, ruler, smart guides, multi-select resize, native undo,
background, font OOXML parity, image crop, autofit, format options/effects,
theme catalog, …) is indexed under the **Slides** section of
[docs/design/README.md](../../docs/design/README.md).
