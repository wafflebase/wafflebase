---
title: Documents and notes
description: Command reference for managing documents, docs, notes, folders, comments, and templates with the wafflebase CLI.
type: reference
---

# Documents and notes

Reference for the `docs`, `notes`, `folders`, `comments`, and `templates` commands.

Conventions: `<doc-id>` is a document ID from `wafflebase docs list`. Every command prints JSON unless you pass `--format`. Every write accepts `--dry-run`, which prints the request instead of sending it. Run `wafflebase schema <command>` for the exact parameters and output of any command, for example `wafflebase schema docs.import`.

## Manage any document

These `docs` commands work on every document type: sheets, docs, decks, notes, boards, PDFs, images, and files.

```bash
wafflebase docs list --format table
wafflebase docs create "Q3 budget"
wafflebase docs create "Launch plan" --type doc
wafflebase docs get <doc-id>
wafflebase docs rename <doc-id> "Q3 budget (final)"
wafflebase docs copy <doc-id>
wafflebase docs move <doc-id> <folder-id>
wafflebase docs delete <doc-id>
```

| Command | What it does |
|---|---|
| `docs list` | Lists every document in the workspace. `--type doc` or `--type sheet` keeps only that type. |
| `docs create <title>` | Creates a sheet. `--type doc` creates a doc instead. |
| `docs get <doc-id>` | Prints the document's metadata. |
| `docs rename <doc-id> <title>` | Renames the document. Any workspace member can rename. |
| `docs copy <doc-id>` | Makes a copy named `<title> (copy)` in the same folder; if that name is taken, the copy gets a number. Comments, share links, and version history are not copied. Any member can copy. |
| `docs move <doc-id> [folder-id]` | Files the document in a folder. Leave out the folder to move it to the workspace root. Needs manager rights: the workspace owner or the document's author. |
| `docs delete <doc-id>` | Moves the document to the trash. |

To create a deck or a note, use [`slides create`](/developers/cli/slides-and-board#manage-decks) or [`notes create`](#notes). The CLI can't create a board; create one in the web app, then edit it with the [`board` commands](/developers/cli/slides-and-board#boards).

Every `delete` command in the CLI (`docs`, `slides`, `notes`, `files`) moves the document to the trash. Restore it, or delete it for good, from the web app. See [Trash](/collaborate/trash).

## Read a doc

`docs content` prints a doc as JSON, Markdown, or plain text.

```bash
wafflebase docs content <doc-id> --format md
wafflebase docs content <doc-id> --format md --pages 1-3,5 --out summary.md
```

| Flag | Description | Default |
|---|---|---|
| `--format <fmt>` | `json`, `md`, or `text` | `json` |
| `--pages <range>` | Pages to include, 1-based, for example `1-3,5`. Pages past the end are skipped with a warning. | all pages |
| `--include-header-footer` | Include headers and footers in `md` and `text`. JSON always includes them. | off |
| `--inline-images` | Keep `data:` image URLs in Markdown | off |
| `--out <file>` | Write to a file. `-` writes to standard output. | standard output |
| `--force` | Overwrite an existing `--out` file | off |

On a sheet, `docs content` fails with `TYPE_MISMATCH`. Read a sheet with [`sheets cells get`](/developers/cli/sheets#read-and-write-cells).

## Export a doc to PDF or Word

```bash
wafflebase docs export <doc-id> proposal.pdf
wafflebase docs export <doc-id> proposal.pdf --pages 1-3
wafflebase docs export <doc-id> proposal.docx
wafflebase docs export <doc-id> - --format pdf > proposal.pdf
```

The format comes from the file extension, `.pdf` or `.docx`. To write to standard output, pass `-` and `--format pdf` or `--format docx`.

| Flag | Description | Default |
|---|---|---|
| `--pages <range>` | Pages to export. PDF only; a `.docx` export ignores it with a warning. | all pages |
| `--include-header-footer` | Include headers and footers. Always on; the flag can't turn them off. | on |
| `--force` | Overwrite an existing file | off |

The CLI fetches the images the doc embeds. An image it can't reach is reported on standard error and left out; the rest of the doc still exports. A doc with Korean text also downloads Noto KR fonts from `cdn.jsdelivr.net` during a PDF export, so the export needs network access to that host.

## Import a Word file

```bash
wafflebase docs import draft.docx --title "Final draft"
cat draft.docx | wafflebase docs import -
wafflebase docs import revision.docx --replace <doc-id> --yes
```

| Flag | Description | Default |
|---|---|---|
| `--title <title>` | Title of the new doc | file name without extension, or `Untitled` from standard input |
| `--replace <doc-id>` | Replace the content of an existing doc instead of creating one | |
| `--yes` | Skip the confirmation prompt for `--replace` | off |

A new doc prints `{ "id", "title" }`; a replace prints `{ "id", "replaced": true }`. `-` reads the file from standard input. In a terminal, `--replace` asks before it overwrites. In a script, it fails with `CONFIRMATION_REQ` unless you pass `--yes`. `--dry-run` never asks.

## Replace a doc's content from JSON

`docs set-content` writes JSON in the shape `docs content` prints, read from `--data` or standard input.

```bash
wafflebase docs content <doc-id> > doc.json
# edit doc.json
wafflebase docs set-content <doc-id> < doc.json
```

::: danger This replaces the whole document
`set-content` overwrites everything in the doc. It doesn't merge and doesn't ask first. Save a copy with `docs copy` or `docs content`, and check the request with `--dry-run`.
:::

The server picks the format from the document's type: a payload that doesn't match fails with `400`, and a sheet fails with `409 TYPE_MISMATCH`.

## Notes

A note's content is one Markdown string. `notes` commands mirror `docs`:

```bash
wafflebase notes list
wafflebase notes create "Standup log"
wafflebase notes get <doc-id>
wafflebase notes rename <doc-id> "Standup log 2026"
wafflebase notes delete <doc-id>
```

### Read and export a note

```bash
wafflebase notes content <doc-id> --format md
wafflebase notes export <doc-id> standup.md
wafflebase notes export <doc-id> - | less
```

| Command | Flag | Description | Default |
|---|---|---|---|
| `notes content` | `--format <fmt>` | `json` prints `{ "content": "…" }`; `md` and `text` print the Markdown as is | `json` |
| `notes content` | `--out <file>`, `--force` | Write to a file; overwrite it | standard output |
| `notes export` | `--format md` | Needed only when the file name doesn't end in `.md` or `.markdown` | from extension |
| `notes export` | `--force` | Overwrite an existing file | off |

### Import a Markdown file

```bash
wafflebase notes import standup.md
cat standup.md | wafflebase notes import - --title "Standup log"
wafflebase notes import standup.md --replace <doc-id> --yes
```

`--title`, `--replace`, and `--yes` work as on [`docs import`](#import-a-word-file).

### Replace a note from JSON

```bash
wafflebase notes set-content <doc-id> --data '{"content": "# Standup\n\n- Shipped the release\n"}'
```

The payload is `{ "content": "…" }`, not raw Markdown. To push a `.md` file into an existing note, use `notes import --replace`. Like `docs set-content`, this overwrites the whole note.

## Folders

Folders organize documents. They don't change who can open them.

```bash
wafflebase folders list
wafflebase folders create "Reports"
wafflebase folders create "2026" --parent <folder-id>
wafflebase folders rename <folder-id> "Quarterly reports"
wafflebase folders move <folder-id> <parent-folder-id>
wafflebase folders delete <folder-id>
```

| Command | What it does |
|---|---|
| `folders list` | Lists every folder as a flat list. Each folder's `parentId` gives the tree. |
| `folders create <name>` | Creates a folder at the root, or inside `--parent <folder-id>`. |
| `folders rename <folder-id> <name>` | Renames the folder. Any member can rename. |
| `folders move <folder-id> [parent-folder-id]` | Moves the folder. Leave out the parent to move it to the root. A folder can't move inside itself. |
| `folders delete <folder-id>` | Deletes the folder and its subfolders. Their documents move to the workspace root; none are deleted. |

Moving and deleting a folder needs manager rights: the workspace owner or the folder's creator. To file a document, use [`docs move`](#manage-any-document). To upload a file straight into a folder, use [`files upload --folder`](/developers/cli/files-and-images#upload-a-file).

## Comments

```bash
wafflebase comments list <doc-id>
wafflebase comments add <doc-id> "Is this total right?" --ref B12 --tab tab-1
wafflebase comments add <doc-id> "Check this chart" --page 0 --rect 0.1,0.2,0.5,0.3
wafflebase comments reply <doc-id> <thread-id> "Fixed, thanks"
wafflebase comments resolve <doc-id> <thread-id>
wafflebase comments unresolve <doc-id> <thread-id>
wafflebase comments delete-comment <doc-id> <thread-id> <comment-id>
wafflebase comments delete <doc-id> <thread-id>
```

`comments add` needs an anchor that matches the document type:

| Document | Flags | Description |
|---|---|---|
| Sheet | `--ref <a1>`, `--tab <tab-id>` | The cell to comment on. `--tab` defaults to `tab-1`. |
| PDF | `--page <n>`, `--rect <x,y,w,h>` | Page index starting at `0`, and a rectangle in page-relative units from `0` to `1` |

Comments work on sheets, docs, and PDFs; other document types fail with `400`. You can't open a new thread on a doc from the CLI, because a text selection can only be made in the editor. Listing, replying, resolving, and deleting work on a doc's threads.

`delete-comment` on a thread's first comment deletes the whole thread. See [Comments](/collaborate/comments) for how threads look in the editor.

## Templates

```bash
wafflebase templates list
wafflebase templates list --scope public --type slides --sort popular
wafflebase templates publish <doc-id> --category Business --tag weekly --visibility workspace
wafflebase templates use <template-id>
```

`templates publish` and `templates use` need a browser session from `wafflebase login`; they refuse an API key. `templates list --scope public` works without signing in.

| Command | Flag | Description | Default |
|---|---|---|---|
| `templates list` | `--scope <scope>` | `workspace` (the active workspace) or `public` | `workspace` |
| | `--type <type>` | `sheet`, `doc`, `slides`, `note`, or `board` | all |
| | `--category <category>`, `--tag <tag>` | Filter by one category or one tag | |
| | `--query <text>` | Search titles, descriptions, and tags | |
| | `--sort <sort>` | `popular` or `recent` | |
| | `--limit <n>`, `--cursor <id>` | Page size from 1 to 50, and the `nextCursor` of the previous page | 24 |
| `templates publish <doc-id>` | `--title`, `--description` | Listing title and description | the document title |
| | `--category <category>` | `Business`, `Education`, `Personal`, `Project management`, `Finance`, `Marketing`, `Design`, or `Other` | |
| | `--tag <tag>` | Add a tag. Repeat for more; up to 10. Tags are stored in lowercase. | |
| | `--visibility <visibility>` | `unlisted` (anyone with the template ID) or `workspace` | |
| `templates use <template-id>` | `--into <workspace>` | Workspace ID or slug to create the new document in | the active workspace |

Publishing again updates the listing; options you leave out keep their current value. Publishing needs manager rights on the document. The public gallery takes a review, which you request from the web app. See [Templates](/collaborate/templates).

## Related

- [Install and sign in](/developers/cli/) for sign-in, profiles, and global options.
- [Sheets](/developers/cli/sheets) to write cells into a new sheet.
- [Files and images](/developers/cli/files-and-images) to store a PDF or any other file.
- [Automation and agents](/developers/cli/automation) to script these commands safely.
- [Document content API](/developers/api/content) for the HTTP calls behind `content` and `set-content`.
