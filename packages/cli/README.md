# @wafflebase/cli

`wafflebase` — terminal access to the Wafflebase REST API for data
pipelines, scripting, CSV/JSON import/export, document management, and
word-processor (`docs content / export / import`) operations.

## Install

```bash
# Local install (recommended for scripts)
npm install -D @wafflebase/cli
npx wafflebase --help

# Global install (recommended for interactive use)
npm install -g @wafflebase/cli
wafflebase --help
```

## Auth

Two paths, in priority order:

1. **API key** (recommended for scripts) — pass `--api-key` /
   `WAFFLEBASE_API_KEY`, or set `api-key:` in `~/.wafflebase/config.yaml`.
2. **OAuth session** — `wafflebase login` opens a browser, completes
   GitHub OAuth, and writes a JWT session to `~/.wafflebase/session.json`.

Always pair API keys with a workspace ID:

```bash
export WAFFLEBASE_API_KEY=wfb_…
export WAFFLEBASE_WORKSPACE=ws-…
```

## Command Tree (v0.3.7)

Plural namespaces are canonical; singular forms are accepted as
aliases for back-compat with earlier scripts.

```
wafflebase
├── login / logout / status                Browser OAuth + session
├── ctx list / switch <name|id>            Workspace context
│
├── docs (aliases: doc, document, documents)
│   ├── list [--type doc|sheet]
│   ├── create <title> [--type doc|sheet]
│   ├── get <doc-id>
│   ├── rename <doc-id> <title>
│   ├── delete <doc-id>
│   ├── content <doc-id>                   --format json|md|text + --pages
│   ├── export <doc-id> <file>             --format pdf|docx + --pages (PDF)
│   └── import <file>                      --replace <id> --yes for in-place
│
├── sheets (aliases: sheet, spreadsheet, spreadsheets)
│   ├── tabs (alias: tab) list <doc-id>
│   ├── cells (alias: cell)
│   │   ├── get <doc-id> [<range>]
│   │   ├── set <doc-id> <ref> <value>     --formula
│   │   ├── batch <doc-id>                 --data <json> | stdin
│   │   └── delete <doc-id> <ref>
│   ├── import <doc-id> <file>             CSV/JSON
│   └── export <doc-id> <file>             CSV/JSON
│
├── api-keys (alias: api-key)
│   ├── create <name>
│   ├── list
│   └── revoke <key-id>
│
└── schema [<command>]                     Discover parameters/safety
```

**Global flags**: `--server`, `--api-key`, `--workspace`, `--profile`,
`--format json|table|csv` (default `json`), `--quiet`, `--verbose`,
`--dry-run`. The `--format` flag also doubles as the per-content shape
on `docs content` (`json|md|text`) and the export type override on
`docs export` (`pdf|docx`).

## Examples

```bash
# Documents
wafflebase docs list
wafflebase docs create "Q1 Notes" --type doc

# Spreadsheets
wafflebase sheets cells get abc-123 A1:D100
echo '{"A1":"Name","B1":"Score"}' | wafflebase sheets cells batch abc-123
wafflebase sheets export abc-123 out.csv

# Word-processor docs
wafflebase docs content abc-123 --format md
wafflebase docs export abc-123 out.pdf --pages 1-3
wafflebase docs import draft.docx --title "Final Draft"
wafflebase docs import revision.docx --replace abc-123 --yes

# Schema introspection (singular aliases resolve too)
wafflebase schema docs.content
wafflebase schema cell.get          # → sheets.cells.get
```

## Output Conventions

- **Text results** (json/md/text): stdout by default; `--out <file>` to
  redirect; `-` writes to stdout explicitly. `--force` is required to
  overwrite an existing `--out` target.
- **Binary results** (pdf/docx): positional `<file>`; `-` writes to stdout.
  `--force` is required to overwrite an existing target.
- **Errors**: a single JSON line on stderr —
  `{"error":{"code":"…","message":"…"}}`. Typed errors (e.g.,
  `INVALID_DOCX`, `TYPE_MISMATCH`, `CONFIRMATION_REQ`) carry a
  command-specific `code` agents can branch on; everything else
  reports `"ERROR"`.
- **Exit codes**: `0` success, `1` user error (bad input, 404, type
  mismatch), `2` system error (network, auth).

## Skills (for AI agents)

Skill files live in `skills/` and ship with the package — namespace
prefixed (`docs-…`, `sheets-…`, `recipe-…`). Agents load them, read
the YAML frontmatter for safety + tool list, and `wafflebase schema
<command>` for parameter shapes. See [`skills/SKILL.md`](skills/SKILL.md)
for the index.

## Design

Full design in [`/docs/design/rest-api-and-cli.md`](../../docs/design/rest-api-and-cli.md)
and [`/docs/design/docs-cli.md`](../../docs/design/docs-cli.md) (the
docs-side `content / export / import` pipeline).
