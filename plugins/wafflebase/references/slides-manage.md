---
name: slides-manage
description: Create, list, get, rename, and delete Wafflebase slide decks
safety: destructive
tools:
  - wafflebase slides list
  - wafflebase slides create
  - wafflebase slides get
  - wafflebase slides rename
  - wafflebase slides delete
---

# Manage Slide Decks

## When to Use

When the user wants to create, list, inspect, rename, or delete
presentation decks (`type: slides`). The `slides` namespace is the
deck-scoped view of the same documents that `docs list` surfaces — its
`list` is pre-filtered to slide decks.

## Commands

### List all slide decks

```bash
wafflebase slides list
```

### Create a deck

```bash
wafflebase slides create "Q1 Kickoff"
```

### Get deck metadata

```bash
wafflebase slides get <doc-id>
```

### Rename a deck

```bash
wafflebase slides rename <doc-id> "New Title"
```

### Delete a deck

```bash
wafflebase slides delete <doc-id>
```

## Dry-Run

Use `--dry-run` for write and destructive operations:

```bash
wafflebase slides create "Test" --dry-run
wafflebase slides rename <doc-id> "New" --dry-run
wafflebase slides delete <doc-id> --dry-run
```

## Singular Aliases

`wafflebase slide …` and `wafflebase deck …` resolve to the same
commands.

## Safety

- `slides.list` and `slides.get` are **read-only** — safe to execute freely.
- `slides.create` and `slides.rename` are **write** — confirm or dry-run first.
- `slides.delete` is **destructive** — always confirm with user before executing.
