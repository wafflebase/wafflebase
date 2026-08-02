# @wafflebase/notes

Markdown note engine for Wafflebase. A CodeMirror 6 source editor with a live
preview, backed by a single Yorkie `Text` CRDT — the whole note lives in one
`root.content` string (byte-compatible with CodePair's format).

Ported from CodePair; this is the engine behind the `"note"` document type.

## Architecture

- **View** — `initialize(container, store, options)` mounts a CodeMirror 6
  editor and returns a `NoteEditorAPI`. `noteSync` binds the editor to the
  store through the `noteStoreFacet`; `noteRemoteSelections` paints peer
  carets/selections. Markdown preview is rendered by `view/preview.ts`, with
  plugins for `<details>`/`<summary>` collapsibles and list empty-bullet
  handling.
- **Store** — the `NoteStore` interface decouples the editor from persistence.
  `MemNoteStore` is the in-package dev store; the production store (Yorkie,
  in the frontend package) syncs the single `Text` CRDT and drives undo/redo
  through Yorkie `doc.history`.
- **Model** — one Yorkie `Text` at `root.content`. There is no block/inline
  tree; the markdown source *is* the model.

## Public API

Exports from `src/index.ts`:

```typescript
// Store
type NoteStore, NoteTextChange, NoteRemoteChange, NotePeerSelection
type Unsubscribe
MemNoteStore

// View
initialize, type NoteEditorAPI, type ThemeMode, type NoteViewMode, type NoteKeymap
type NoteInlineFormats
noteStoreFacet, noteSync
noteRemoteSelections, noteRemoteSelectionsTheme
```

## Build

```bash
pnpm --filter @wafflebase/notes build
```

## Further Reading

- [notes.md](../../docs/design/notes/notes.md) — data model, CodeMirror
  integration, CodePair byte-compatibility, and the rollout phases.
