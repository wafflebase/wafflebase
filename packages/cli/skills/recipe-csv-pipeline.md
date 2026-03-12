---
name: recipe-csv-pipeline
description: Import CSV data into a spreadsheet, apply formulas, and export results
safety: write
---

# CSV Analysis Pipeline

## When to Use

When the user wants to import a CSV file into Wafflebase, add analysis formulas,
and optionally export the results.

## Steps

### 1. Create a new document

```bash
DOC_ID=$(wafflebase doc create "Q1 Analysis" --format json | jq -r '.id')
```

### 2. Import CSV data as batch cell updates

Convert CSV rows to the JSON batch format and write them:

```bash
# Example: convert CSV to batch JSON (header + 3 rows)
cat <<'EOF' > /tmp/batch.json
{"A1":"Name","B1":"Revenue","C1":"Region","A2":"Alice","B2":"50000","C2":"East","A3":"Bob","B3":"62000","C3":"West","A4":"Carol","B4":"48000","C4":"East"}
EOF

wafflebase cell batch "$DOC_ID" --data "$(cat /tmp/batch.json)"
```

### 3. Add summary formulas

```bash
echo '{"E1":"Total","E2":"=SUM(B2:B100)","E3":"Average","E4":"=AVERAGE(B2:B100)","E5":"Count","E6":"=COUNTA(A2:A100)"}' \
  | wafflebase cell batch "$DOC_ID"
```

### 4. Verify the data

```bash
wafflebase cell get "$DOC_ID" A1:E6
```

## Notes

- The `import` command is not yet available. Use `cell batch` with converted JSON.
- For large datasets, split batch updates into chunks of ~500 cells.
- Always verify data after import by reading back a sample range.
