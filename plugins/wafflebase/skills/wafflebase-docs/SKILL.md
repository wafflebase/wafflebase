---
name: wafflebase-docs
description: Use for Wafflebase word-processor docs and markdown notes — reading or summarizing a doc, turning repository files into a doc or note, editing doc or note text, DOCX import/export, PDF export. Load the core `wafflebase` skill first for setup, links and the write protocol.
---

# Wafflebase Docs and Notes

Follow the core `wafflebase` skill's read and write protocol. Exact
flags: `wafflebase schema docs.<command>` / `notes.<command>`.

Two document types, two different editing stories:

| | Doc (`type: doc`) | Note (`type: note`) |
| --- | --- | --- |
| Is | Paginated rich-text document | One Markdown text |
| Read | `docs content <id> --format md` | `notes content <id> --format md` |
| Create from a file | `docs import file.docx` | `notes import file.md` |
| Edit text | Whole replace of the JSON tree (see below) | `notes import edited.md --replace <id>` |

When the user wants to publish Markdown from the repository, a **note**
is the faithful target. Only use a doc when they ask for one (or for a
DOCX).

## Reading

```bash
wafflebase docs content <id> --format md --pages 1-3     # a slice of a long doc
wafflebase docs content <id> --format text               # cheapest to read
wafflebase notes content <id> --format md
```

Read page ranges of long docs rather than the whole thing.

## Creating

```bash
wafflebase notes import README.md --title "Release notes 0.7"
wafflebase docs import proposal.docx --title "Proposal"
wafflebase docs create "Meeting notes" --type doc        # empty doc
```

## Editing a note

Write the edited Markdown to a file, then replace — after a backup copy:

```bash
wafflebase notes content <id> --format md --out note.md   # current text
# … edit note.md …
wafflebase docs copy <id>                                  # restore point
wafflebase notes import note.md --replace <id> --yes       # only after the user approved
```

## Editing a doc

There is no partial-edit command for docs yet: every text edit replaces
the whole document tree, which overwrites anything a collaborator typed
meanwhile. Keep it deliberate:

1. Say exactly which paragraphs will change and confirm the user wants
   the edit applied rather than suggested.
2. `wafflebase docs copy <id>` — restore point; give the user its link.
3. `wafflebase docs content <id> --format json --out doc.json`.
4. Change only the blocks that need changing in `doc.json`; leave every
   other block byte-identical.
5. `wafflebase docs set-content <id> < doc.json` — or `--data`.

For a small change the user can make faster in the editor, offer the link
and the exact suggested wording instead — a suggestion is often the
better answer than a whole replace.

## Export

```bash
wafflebase docs export <id> out.pdf [--pages 1-3]
wafflebase docs export <id> out.docx
wafflebase notes export <id> note.md
```

## References

- [references/docs-manage.md](../../references/docs-manage.md)
- [references/docs-read-content.md](../../references/docs-read-content.md)
- [references/docs-import-docx.md](../../references/docs-import-docx.md)
- [references/docs-export-docx.md](../../references/docs-export-docx.md)
- [references/docs-export-pdf.md](../../references/docs-export-pdf.md)
- [references/recipe-doc-to-markdown.md](../../references/recipe-doc-to-markdown.md)
- [references/recipe-docx-to-pdf.md](../../references/recipe-docx-to-pdf.md)
