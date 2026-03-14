# CLI

The Wafflebase CLI lets you manage documents and cells from the terminal.

## Installation

```bash
npm install -g @wafflebase/cli
```

## Configuration

The CLI resolves settings in this order: **flags > environment variables > config file**.

### Config File

Location: `~/.config/wafflebase/config.yaml`

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
| `--server <url>` | Server URL | `http://localhost:3000` |
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

### Script: Export to CSV

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
GET http://localhost:3000/api/v1/workspaces/.../cells/A1
```
