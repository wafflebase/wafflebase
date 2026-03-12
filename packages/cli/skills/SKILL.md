# Wafflebase CLI Skills

Skills are Markdown files that serve as self-contained instruction sets for
AI agents. Each skill describes a focused capability with command syntax,
examples, and safety notes.

## Conventions

- **Frontmatter**: Every skill has YAML frontmatter with `name`, `description`,
  `safety`, and `tools` fields.
- **Safety levels**: `read-only` (no confirmation needed), `write` (confirm or
  dry-run first), `destructive` (always confirm with user).
- **Recipes** are prefixed with `recipe-` and compose multiple skills into
  multi-step workflows.

## Available Skills

| File | Safety | Description |
|------|--------|-------------|
| [read-cells.md](read-cells.md) | read-only | Read cell data from spreadsheets |
| [write-cells.md](write-cells.md) | write | Write cell data to spreadsheets |
| [manage-docs.md](manage-docs.md) | write | Create, rename, and delete documents |

## Available Recipes

| File | Safety | Description |
|------|--------|-------------|
| [recipe-csv-pipeline.md](recipe-csv-pipeline.md) | write | CSV import, formula analysis, export |
| [recipe-data-collect.md](recipe-data-collect.md) | read-only | Collect and compare data across documents |

## How Agents Use Skills

1. Load the relevant skill file based on the user's intent
2. Read frontmatter to understand safety level and available tools
3. Use `wafflebase schema <command>` for parameter details
4. For write operations, run with `--dry-run` first to show intent
5. Execute commands and parse JSON output
6. On error, parse the JSON error response to decide next action
