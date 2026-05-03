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

### 1. Create a new spreadsheet

```bash
DOC_ID=$(wafflebase docs create "Q1 Analysis" --format json | jq -r '.id')
```

### 2. Import the CSV

```bash
wafflebase sheets import "$DOC_ID" sales.csv
```

### 3. Add summary formulas

```bash
echo '{"E1":"Total","E2":"=SUM(B2:B100)","E3":"Average","E4":"=AVERAGE(B2:B100)","E5":"Count","E6":"=COUNTA(A2:A100)"}' \
  | wafflebase sheets cells batch "$DOC_ID"
```

### 4. Verify the data

```bash
wafflebase sheets cells get "$DOC_ID" A1:E6
```

### 5. Export results

```bash
wafflebase sheets export "$DOC_ID" out.csv --range A1:E6
```

## Notes

- The full pipeline uses `docs create` (now plural) and `sheets …` for
  every spreadsheet-side step.
- For large datasets, split batch updates into chunks of ~500 cells.
- Always verify data after import by reading back a sample range.
