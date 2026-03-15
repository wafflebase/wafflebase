# CLI

The Wafflebase CLI lets you manage documents and cells from the terminal.

## Installation

```bash
npm install -g @wafflebase/cli
```

## Authentication

### OAuth Login (recommended)

Log in via GitHub OAuth in the browser:

```bash
wafflebase login
```

The CLI opens your browser for GitHub authentication and stores the JWT session in `~/.wafflebase/session.json`. Tokens are automatically refreshed when they expire.

To log in to a different server:

```bash
wafflebase login --server https://api.example.com
```

### Check Status

```bash
wafflebase status
```

### Logout

```bash
wafflebase logout
```

### Workspace Context Switching

If you have access to multiple workspaces:

```bash
# List workspaces (* = active)
wafflebase ctx list

# Switch active workspace
wafflebase ctx switch "Team Workspace"
wafflebase ctx switch e98ff707
```

### API Key Auth (CI/scripts)

For non-interactive environments, use API keys:

```bash
wafflebase --api-key wfb_xxx document list
# Or via environment variable:
export WAFFLEBASE_API_KEY=wfb_xxx
```

## Configuration

The CLI resolves auth in this order: **flag/env API key > session JWT > config file API key**.

Settings resolve as: **flags > environment variables > session > config file**.

### Config File

Location: `~/.wafflebase/config.yaml`

```yaml
profiles:
  default:
    server: http://localhost:3000
    api-key: wfb_your_api_key_here
    workspace: your-workspace-id
```

You can define multiple profiles and switch between them with `--profile`:

```bash
wafflebase --profile production document list
```

### Environment Variables

```bash
export WAFFLEBASE_SERVER=http://localhost:3000
export WAFFLEBASE_API_KEY=wfb_your_api_key
export WAFFLEBASE_WORKSPACE=your-workspace-id
```

## Global Options

| Flag | Description | Default |
|------|-------------|---------|
| `--server <url>` | Server URL | `https://wafflebase-api.yorkie.dev` |
| `--api-key <key>` | API key | — |
| `--workspace <id>` | Workspace ID | — |
| `--profile <name>` | Config profile | `default` |
| `--format <fmt>` | Output format: `json`, `table`, `csv` | `json` |
| `--quiet` | Suppress output | `false` |
| `--verbose` | Verbose output | `false` |
| `--dry-run` | Show request without executing | `false` |

## Commands

### document (alias: doc)

Manage spreadsheet documents.

```bash
# List all documents
wafflebase document list

# Create a new document
wafflebase document create "Q1 Report"

# Get document metadata
wafflebase document get <doc-id>

# Rename a document
wafflebase document rename <doc-id> "New Title"

# Delete a document
wafflebase document delete <doc-id>
```

### tab

Manage tabs within a document.

```bash
# List tabs in a document
wafflebase tab list <doc-id>
```

### cell

Read and write cell data.

```bash
# Get all cells (default tab)
wafflebase cell get <doc-id>

# Get a specific cell
wafflebase cell get <doc-id> A1

# Get a range
wafflebase cell get <doc-id> A1:C10

# Specify a tab
wafflebase cell get <doc-id> A1:C10 --tab tab-2

# Set a cell value
wafflebase cell set <doc-id> A1 "Revenue"

# Set a formula
wafflebase cell set <doc-id> B2 "=SUM(A1:A10)" --formula

# Delete a cell
wafflebase cell delete <doc-id> A1

# Batch update (inline JSON)
wafflebase cell batch <doc-id> \
  --data '{"A1": {"value": "Name"}, "B1": {"value": "Score"}}'

# Batch update (from stdin)
echo '{"A1": {"value": "1"}, "A2": {"value": "2"}}' | \
  wafflebase cell batch <doc-id>
```

### api-key

Manage API keys for programmatic access.

```bash
# Create a new API key
wafflebase api-key create "My Integration"

# List API keys
wafflebase api-key list

# Revoke an API key
wafflebase api-key revoke <key-id>
```

### schema

Inspect available commands and their parameters.

```bash
# List all commands
wafflebase schema

# Describe a specific command
wafflebase schema document.list
wafflebase schema cell.get
```

### import

Import CSV or JSON data into a spreadsheet tab.

```bash
# Import a CSV file
wafflebase import <doc-id> data.csv

# Import a JSON file
wafflebase import <doc-id> data.json

# Import from stdin
cat data.csv | wafflebase import <doc-id> -

# Import starting at a specific cell
wafflebase import <doc-id> data.csv --start C5

# Target a specific tab
wafflebase import <doc-id> data.csv --tab tab-2

# Preview without writing
wafflebase import <doc-id> data.csv --dry-run
```

| Option | Description | Default |
|--------|-------------|---------|
| `--tab <tab-id>` | Target tab | `tab-1` |
| `--format <fmt>` | File format (`csv`, `json`) | auto-detected |
| `--no-header` | First row is data, not a header | `false` |
| `--start <ref>` | Top-left cell for import | `A1` |

JSON input accepts an array of arrays or an array of objects:

```json
[
  { "Name": "Alice", "Score": 95 },
  { "Name": "Bob", "Score": 87 }
]
```

### export

Export tab data to a CSV or JSON file.

```bash
# Export to CSV
wafflebase export <doc-id> output.csv

# Export to JSON
wafflebase export <doc-id> output.json

# Export a specific range
wafflebase export <doc-id> output.csv --range A1:D100

# Export to stdout (pipe-friendly)
wafflebase export <doc-id> - --format csv | head -20
```

| Option | Description | Default |
|--------|-------------|---------|
| `--tab <tab-id>` | Source tab | `tab-1` |
| `--range <range>` | Cell range to export | all data |
| `--format <fmt>` | Output format (`csv`, `json`) | auto-detected |

## Output Formats

### JSON (default)

```bash
$ wafflebase document list
[
  {"id": "abc-123", "title": "Q1 Report"},
  {"id": "def-456", "title": "Budget"}
]
```

### Table

```bash
$ wafflebase --format table document list
┌─────────┬───────────┐
│ ID      │ Title     │
├─────────┼───────────┤
│ abc-123 │ Q1 Report │
│ def-456 │ Budget    │
└─────────┴───────────┘
```

### CSV

```bash
$ wafflebase --format csv cell get abc-123 A1:B3
A1,Revenue
A2,1000
B1,Expenses
B2,500
```

## Examples

### Import CSV, add formulas, export results

```bash
# Import raw data
wafflebase import abc-123 sales.csv

# Add a SUM formula
wafflebase cell set abc-123 C1 "=SUM(B2:B100)" --formula

# Export results
wafflebase export abc-123 report.csv --range A1:C100
```

### Export to CSV (cell get)

```bash
wafflebase --format csv cell get abc-123 A1:Z100 > report.csv
```

### Script: Populate from data

```bash
wafflebase cell batch abc-123 --data '{
  "A1": {"value": "Name"},
  "B1": {"value": "Email"},
  "A2": {"value": "Alice"},
  "B2": {"value": "alice@example.com"}
}'
```

### Dry-run mode

```bash
$ wafflebase --dry-run cell set abc-123 A1 "Hello"
{
  "dry_run": true,
  "method": "PUT",
  "url": "http://localhost:3000/api/v1/workspaces/.../cells/A1",
  "body": { "value": "Hello" }
}
```
