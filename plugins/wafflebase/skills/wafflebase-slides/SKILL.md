---
name: wafflebase-slides
description: Use for Wafflebase slide decks — reading or summarizing a deck, adding, duplicating, reordering or deleting slides, building a deck from a PPTX, PPTX export. Load the core `wafflebase` skill first for setup, links and the write protocol.
---

# Wafflebase Slides

Follow the core `wafflebase` skill's read and write protocol. Exact
flags: `wafflebase schema slides.<command>`.

## Reading

```bash
wafflebase slides content <id> --format md              # outline: one `## Slide N` per slide, text only
wafflebase slides content <id> --format md --notes      # with speaker notes
wafflebase slides layouts <id>                          # layout ids for new slides
```

Use `--format json` only when you need element ids or positions — it is
much larger.

## Slide operations (granular — prefer these)

```bash
wafflebase slides slide add <id> --layout <layout-id> [--index 3]
wafflebase slides slide duplicate <id> <slide-id>
wafflebase slides slide move <id> <slide-id> <index>
wafflebase slides slide delete <id> <slide-id>
```

Slide ids come from `slides content <id> --format json`. Positions are
1-based.

## Building and replacing decks

```bash
wafflebase slides import deck.pptx --title "Q3 review"        # new deck
wafflebase slides export <id> deck.pptx
```

Changing text inside existing slides means replacing the deck's whole
JSON (`slides set-content`) or a PPTX (`slides import … --replace <id>`).
Both overwrite collaborators' concurrent edits: make a `docs copy <id>`
restore point first, say which slides change, and only pass `--yes` after
the user approved the replace. For a one-line wording fix, offer the link
and the suggested text instead.

## References

- [references/slides-manage.md](references/slides-manage.md)
- [references/slides-read-content.md](references/slides-read-content.md)
- [references/slides-import-pptx.md](references/slides-import-pptx.md)
- [references/slides-export-pptx.md](references/slides-export-pptx.md)
