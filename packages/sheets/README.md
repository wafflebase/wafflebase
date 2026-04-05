# @wafflebase/sheets

Core spreadsheet engine for Wafflebase. Provides the data model, formula evaluation, Canvas-based rendering, and a store abstraction for persistence.

## Architecture

```
┌─────────────────┐ ┌─────────────────┐ ┌────────────────┐
│  Spreadsheet    │ │  Worksheet      │ │     Store      │
│ ┌────────────┐  │ │ ┌─────────────┐ │ │  ┌──────────┐  │
│ │ Data       │  │ │ │ Data Model  │ │ │  │Save/Load │  │
│ │ Rendering  │  │ │ │             │ │ │  └──────────┘  │
│ └────────────┘  │ │ └─────────────┘ │ └────────────────┘
│                 │ │                 │ ┌────────────────┐
│ ┌────────────┐  │ │ ┌─────────────┐ │ │    Formula     │
│ │ User Input │  │ │ │ Cell        │ │ │ ┌────────────┐ │
│ │ Processing │  │ │ │ Calculation │ │ │ │ Evaluation │ │
│ └────────────┘  │ │ └─────────────┘ │ │ └────────────┘ │
└─────────────────┘ └─────────────────┘ └────────────────┘
```

- **Spreadsheet** — Top-level entry point. Manages the Worksheet, handles initialization, and provides the `initialize()` factory function.
- **Worksheet** — Orchestrates rendering (GridCanvas, Overlay), scroll management (GridContainer), user input (keyboard, mouse, context menu), and cell editing.
- **Store** — Interface that decouples the engine from persistence. `MemStore` is the built-in in-memory implementation; `YorkieStore` (in the frontend package) adds real-time collaboration.
- **Formula** — ANTLR4-based parser and visitor-pattern evaluator. Supports arithmetic, cell/range references, and built-in functions (SUM, etc.).

## Key Concepts

| Concept | Description |
|---------|-------------|
| `Sheet` | Core data model — cell access, selection, navigation, row/column operations, copy/paste |
| `Cell` | `{ v?: string; f?: string }` — display value and optional formula |
| `Ref` | `{ r: number; c: number }` — numeric cell coordinate (1-based) |
| `Sref` | String cell reference, e.g. `"A1"` |
| `Range` | `[Ref, Ref]` — top-left and bottom-right corners |
| `Grid` | `Map<Sref, Cell>` — sparse map of cells |
| `DimensionIndex` | Manages variable row heights / column widths with binary-search lookup |
| `Calculator` | Topological-sort dependency graph for formula recalculation with cycle detection |

## Public API

Exports from `src/index.ts`:

```typescript
// View
initialize, Spreadsheet

// Data model
Store, Grid, Cell, Ref, Sref, Range, Direction, Axis, DimensionIndex

// Coordinates
toSref, toSrefs, parseRef, inRange

// Formula
extractReferences

// Shifting (insert/delete rows/columns)
shiftSref, shiftFormula, shiftDimensionMap
```

### Usage

```typescript
import { initialize } from '@wafflebase/sheets';

const spreadsheet = await initialize(containerElement, {
  theme: 'light', // or 'dark'
  store: myStore,  // optional — defaults to MemStore
});

// Optional host-driven mobile gestures
spreadsheet.panBy(0, 120);
spreadsheet.handleMobileDoubleTap(180, 420);
```

## Development

```bash
# Build the library
pnpm sheet build

# Run tests (Vitest)
pnpm test

# Regenerate ANTLR formula parser (after editing Formula.g4)
pnpm sheet build:formula
```

## Further Reading

See [/docs/design/sheets/sheet.md](../../docs/design/sheets/sheet.md) for the full design document covering the data model, store interface, formula engine, rendering pipeline, and coordinate system.
