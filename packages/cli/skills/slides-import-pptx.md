---
name: slides-import-pptx
description: Import a .pptx file as a new (or replacement) Wafflebase slide deck
safety: write
tools:
  - wafflebase slides import
---

# Import a PPTX File

## When to Use

When the user wants to bring a `.pptx` file into Wafflebase — either as
a brand-new deck or as a replacement for an existing one. Import is
best-effort: unknown shapes, unsupported layout types, and skipped
images are reported in the result's `report` field.

## Variants

| Variant                    | Safety       | Notes                                       |
| -------------------------- | ------------ | ------------------------------------------- |
| Default (new deck)         | write        | POST `/documents` (type slides) then PUT `/content` |
| `--replace <id> --yes`     | destructive  | PUT `/content` only; overwrites in place    |

## Commands

### Create a new deck

```bash
wafflebase slides import deck.pptx
wafflebase slides import deck.pptx --title "Q1 Kickoff"
```

Without `--title`, the CLI uses the file basename minus its extension.

### Read from stdin

```bash
cat deck.pptx | wafflebase slides import -
```

### Replace an existing deck

```bash
wafflebase slides import revision.pptx --replace <doc-id> --yes
```

`--replace` is **destructive** — it overwrites the deck's content
without an undo path. Pair with `--yes` (non-interactive) or respond
`y` to the interactive prompt (TTY). Without `--yes` on a
non-interactive shell, the CLI exits with `CONFIRMATION_REQ`.

### Dry-run

```bash
wafflebase slides import deck.pptx --dry-run                    # POST + PUT preview
wafflebase slides import revision.pptx --replace <id> --dry-run # PUT preview only
```

## Image Handling

Images from the .pptx are encoded as `data:` URLs and embedded directly
in the imported deck JSON — the deck is self-contained.

## Errors

- `INVALID_PPTX` — the file is not a parseable .pptx
- `CONFIRMATION_REQ` — `--replace` without `--yes` on a non-TTY shell
- `HTTP_ERROR` — the server rejected the create or content PUT

## Safety

- Default: **write** — creates a new deck
- `--replace`: **destructive** — overwrites existing content
