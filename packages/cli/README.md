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
   The login callback is bound to a per-attempt nonce, which the backend
   echoes back as the callback's `state`, so a server that predates that
   echo never completes one; against such a server (a self-hosted backend
   that has not upgraded yet) pass
   `wafflebase login --allow-unbound-callback` to accept its `state`-less
   callback anyway. It warns on stderr, and a *mismatched* `state` stays
   refused under the flag.

Always pair API keys with a workspace ID:

```bash
export WAFFLEBASE_API_KEY=wfb_…
export WAFFLEBASE_WORKSPACE=ws-…
```

## Image fetching

`docs export` / `slides export` fetch the images a document references. An
image `src` is content someone else may have written, so the fetcher speaks
only `http`/`https`/`data` and refuses a non-public address (loopback,
private, `169.254.169.254`, CGNAT, multicast/reserved, and the IPv6
spellings of all of those) unless it is the configured `--server`'s own host
**and port**. The hostname is resolved before it is fetched and judged per
address, so `169.254.169.254.nip.io` and friends get no further than the
literal would, and the request is then pinned to the addresses that check
approved — DNS cannot answer differently between the check and the
connection. Every redirect hop is gated the same way, up to five.

An image that is refused or unreachable is reported on stderr and skipped,
rather than failing the whole export: one `src` you cannot fix must not cost
you the export you asked for. The rest of the document still exports, minus
those images.

## Command Tree

Plural namespaces are canonical; singular forms are accepted as
aliases for back-compat with earlier scripts. `wafflebase schema` is the
machine-readable version of this tree — every command below has an entry
there carrying its parameters, response shape and safety level.

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
│   ├── copy <doc-id>                      → "<title> (copy)" (any type)
│   ├── move <doc-id> [folder-id]          Omit the folder for the root
│   ├── delete <doc-id>
│   ├── content <doc-id>                   --format json|md|text + --pages
│   ├── export <doc-id> <file>             --format pdf|docx + --pages (PDF)
│   ├── import <file>                      --replace <id> --yes for in-place
│   └── set-content <doc-id>               --data <json> | stdin (destructive)
│
│   slides and notes mirror docs: list / create / get / rename / delete /
│   content / export / import / set-content.
│
├── sheets (aliases: sheet, spreadsheet, spreadsheets)
│   ├── tabs (alias: tab)
│   │   ├── list <doc-id>
│   │   ├── create <doc-id> [name]        --type sheet
│   │   └── rename <doc-id> <tab-id> <name>
│   ├── cells (alias: cell)
│   │   ├── get <doc-id> [<range>]
│   │   ├── set <doc-id> <ref> <value>     --formula
│   │   ├── batch <doc-id>                 --data <json> | stdin
│   │   └── delete <doc-id> <ref>
│   ├── import <doc-id> <file>             CSV/JSON
│   ├── export <doc-id> <file>             CSV/JSON
│   ├── clear / insert / delete / move <doc-id>
│   │                                      --data <json> | stdin. insert /
│   │                                      delete / move act on rows or
│   │                                      columns; clear empties a range
│   └── get/set pairs over the rest of a tab's state, each --tab + --data:
│       styles (style, range-styles) · sheet-style · column-styles ·
│       row-styles · column-widths · row-heights · freeze · hidden ·
│       merges (merge) · conditional-formats · data-validations ·
│       charts (chart) · filter · pivot
│
├── files (alias: file)                    Any file, stored as bytes
│   └── upload / download / list / get / rename / delete
│
├── images (alias: image)                  Workspace image bucket
│   ├── upload <file>                      png|jpeg|gif|webp, 10 MB cap
│   ├── get <image-id> [out]               --force to overwrite
│   └── delete <image-id>
│
├── folders (alias: folder)                Workspace folder tree
│   ├── list                               Flat; parentId builds the tree
│   ├── create <name>                      --parent <id>, else the root
│   ├── rename <folder-id> <name>
│   ├── move <folder-id> [parent-id]       Omit the parent for the root
│   └── delete <folder-id>                 Its documents go to the root
│
├── api-keys (alias: api-key)
│   ├── create <name>
│   ├── list
│   └── revoke <key-id>
│
└── schema [<command>]                     Discover parameters/safety
```

**Global flags**: `--server`, `--api-key`, `--workspace`, `--profile`,
`--format json|table|csv|yaml` (default `json`), `--quiet` (suppresses
progress notices only — the result body and the JSON error envelope are
always emitted), `--verbose`,
`--dry-run`. The `--format` flag also doubles as the per-content shape
on `docs content` (`json|md|text`) and the export type override on
`docs export` (`pdf|docx`).

## Examples

```bash
# Documents
wafflebase docs list
wafflebase docs create "Q1 Notes" --type doc

# Spreadsheets
wafflebase sheets tabs create abc-123 "History"
wafflebase sheets tabs rename abc-123 tab-1 "Summary"
wafflebase sheets cells get abc-123 A1:D100
echo '{"A1":"Name","B1":"Score"}' | wafflebase sheets cells batch abc-123
wafflebase sheets export abc-123 out.csv

# Everything on a tab that is not a cell (get/set pairs, JSON on stdin)
wafflebase sheets styles get abc-123
echo '{"1":180,"2":90}' | wafflebase sheets column-widths set abc-123
echo '{"rows":1,"cols":0}' | wafflebase sheets freeze set abc-123
wafflebase sheets charts get abc-123 | wafflebase sheets charts set abc-123

# Rows and columns (delete removes rows/columns; clear empties a range)
echo '{"range":"A2:C99"}' | wafflebase sheets clear abc-123
echo '{"axis":"row","index":2,"count":3}' | wafflebase sheets insert abc-123

# Workspace images
wafflebase images upload logo.png
wafflebase images get img-42 logo.png --force

# Folders (organizational only — they carry no permissions)
wafflebase folders create "Q1 Reports"
wafflebase folders list
wafflebase docs move abc-123 fld-1          # file it; omit fld-1 for the root
wafflebase docs copy abc-123                # → "<title> (copy)"

# Word-processor docs
wafflebase docs content abc-123 --format md
wafflebase docs export abc-123 out.pdf --pages 1-3
wafflebase docs import draft.docx --title "Final Draft"
wafflebase docs import revision.docx --replace abc-123 --yes
wafflebase docs content abc-123 | wafflebase docs set-content abc-123

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
  `{"error":{"code":"…","message":"…","command":"docs.content"}}`. `command`
  is the dotted command name (the same string `schema` indexes on), so a
  caller running several commands can tell which one failed. Typed errors (e.g.,
  `INVALID_DOCX`, `TYPE_MISMATCH`, `CONFIRMATION_REQ`) carry a
  command-specific `code` agents can branch on; argument-parsing
  failures (missing argument, unknown option, unknown command) report
  `USAGE`. A failed request whose
  body the backend did *not* send in that shape (an Express/Nest
  `{message, error, statusCode}` 404/500, an HTML proxy page) reports
  `"HTTP_ERROR"` — or `"AUTH_ERROR"` / `"SERVER_ERROR"` when the status
  says so — with `"HTTP <status>"` plus the upstream's own wording when
  it had any, as `"HTTP 404: Document has no file"`. Every command
  reports the same code for that condition, so the branch does not
  depend on which subcommand ran. Local failures (bad input, a
  filesystem error) still report `"ERROR"`.
- **Forwarded backend errors are bounded**: when the backend *did* send
  the envelope, its own `code` is what you get — that is the value to
  branch on, and it is never rewritten. The surrounding text is capped,
  because it is upstream-controlled content going straight into an
  agent's stderr: `code` is truncated at 80 characters, `message` at 500
  (with a trailing `…`), a `message` that is an HTML document is replaced
  by `"HTTP <status>"`, and any extra field the backend attached (a
  request id) is dropped once the whole body exceeds 4,000 bytes, leaving
  `{code, message}`. Treat `message` as a display string, not a parseable
  payload. `command` is the one field never forwarded: attribution is the
  CLI's statement about which command *it* ran, so a server cannot
  relabel which call failed.
- **Exit codes**: `0` success, `1` user error (bad input, 404, type
  mismatch), `2` system error — an unreachable server
  (`NETWORK_ERROR`), rejected credentials (`AUTH_ERROR`, HTTP 401/403),
  or a server fault (`SERVER_ERROR`, HTTP 5xx). A 2xx the CLI cannot use
  — a create that returned no id, a download that returned no bytes — is
  a server fault too. The class is decided where the failure is raised,
  so `--quiet` reports it too.
- **Proxies**: image downloads during `docs export` / `slides export`
  honor `http_proxy` / `https_proxy` / `all_proxy` and `no_proxy` (either
  letter case).

## Skills (for AI agents)

Skill files live in `skills/` and ship with the package — namespace
prefixed (`docs-…`, `sheets-…`, `recipe-…`). Agents load them, read
the YAML frontmatter for safety + tool list, and `wafflebase schema
<command>` for parameter shapes. See [`skills/SKILL.md`](skills/SKILL.md)
for the index.

## Design

Full design in [`/docs/design/rest-api.md`](../../docs/design/rest-api.md)
and [`/docs/design/cli.md`](../../docs/design/cli.md) (the
docs-side `content / export / import` pipeline).
