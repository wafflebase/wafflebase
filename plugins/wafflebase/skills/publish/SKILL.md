---
description: Publish a local file to Wafflebase as the matching document type and return its link
argument-hint: <file> [title]
disable-model-invocation: true
---

Publish to Wafflebase: $ARGUMENTS

Follow the core `wafflebase` skill. The first argument is a local path;
the rest, if any, is the title. Without one, let each command apply its
own default: imports use the file name without its extension, while
`files upload` keeps the whole file name — the title is the only place a
blob's extension survives.

Pick the target from the file:

| File | Command |
| --- | --- |
| `.md`, `.markdown` | `wafflebase notes import <file> [--title "<title>"]` |
| `.csv` | `wafflebase docs create "<title or file name without extension>"`, then `wafflebase sheets import <new-id> <file>` |
| `.docx` | `wafflebase docs import <file> [--title "<title>"]` |
| `.pptx` | `wafflebase slides import <file> [--title "<title>"]` |
| anything else | `wafflebase files upload <file> [--title "<title>"] [--folder <folder-id>]` |

1. Check the file exists. If the user named a folder, find its id with
   `wafflebase folders list`.
2. State the plan in one line (file → type, title, folder), then run it.
   Each command is confirmed by the plugin's guard before it runs.
3. If a folder was named and the command had no `--folder`, `wafflebase
   docs move <new-id> <folder-id>`.
4. Reply with the link to the new document.

This always creates a new document. To update an existing one, the user
asks for that explicitly and the type skill's replace protocol applies.
