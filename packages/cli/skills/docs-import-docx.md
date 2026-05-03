---
name: docs-import-docx
description: Import a .docx file as a new (or replacement) Wafflebase document
safety: write
tools:
  - wafflebase docs import
---

# Import a DOCX File

## When to Use

When the user wants to bring a `.docx` file into Wafflebase — either as
a brand-new document or as a replacement for an existing one.

## Variants

| Variant                    | Safety       | Notes                                       |
| -------------------------- | ------------ | ------------------------------------------- |
| Default (new doc)          | write        | POST `/documents` then PUT `/content`       |
| `--replace <id> --yes`     | destructive  | PUT `/content` only; overwrites in place    |

## Commands

### Create a new document

```bash
wafflebase docs import draft.docx
wafflebase docs import draft.docx --title "Final Draft"
```

Without `--title`, the CLI uses the file basename minus its extension
(`draft.docx` → `draft`).

### Read from stdin

```bash
cat draft.docx | wafflebase docs import -
```

`-` reads bytes from stdin. The default title becomes `Untitled`
because there's no path to derive one from.

### Replace an existing document

```bash
wafflebase docs import revision.docx --replace <doc-id> --yes
```

`--replace` is **destructive** — it overwrites the document's content
without an undo path. Always pair with `--yes` (non-interactive) or
respond `y` to the interactive prompt (TTY).

Without `--yes` on a non-interactive shell, the CLI exits with:

```json
{ "error": { "code": "CONFIRMATION_REQ", "message": "Pass --yes to confirm replacing document \"<id>\"." } }
```

### Dry-run

```bash
wafflebase docs import draft.docx --dry-run                       # POST + PUT preview
wafflebase docs import revision.docx --replace <id> --dry-run     # PUT preview only
```

`--dry-run` skips the network and prints the request that *would* fire.

## Image Handling

Image inlines from the .docx are encoded as `data:` URLs and embedded
directly in the imported document JSON. No external image upload
endpoint is involved (yet) — the entire document is self-contained.

## Errors

- `INVALID_DOCX` — the file is not a parseable .docx (missing
  `word/document.xml`, malformed zip, etc.)
- `CONFIRMATION_REQ` — `--replace` without `--yes` on a non-TTY shell
- `HTTP_ERROR` — the server rejected the create or content PUT

## Safety

- Default: **write** — creates a new document
- `--replace`: **destructive** — overwrites existing content
