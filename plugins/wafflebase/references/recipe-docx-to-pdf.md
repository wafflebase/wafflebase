---
name: recipe-docx-to-pdf
description: Round-trip a .docx file through Wafflebase to produce a clean PDF
safety: write
---

# DOCX → Wafflebase → PDF

## When to Use

When the user has a `.docx` file and wants a PDF rendered through
Wafflebase's pagination engine (consistent fonts, page breaks, header /
footer rendering — independent of the user's local Word install).

## Steps

### 1. Import the .docx

```bash
DOC_ID=$(wafflebase docs import draft.docx --format json | jq -r '.id')
```

Captures the new document's id from the JSON output.

### 2. (Optional) Inspect the imported content

```bash
wafflebase docs content "$DOC_ID" --format md
```

A quick eyeball check that the import preserved the structure you
expect.

### 3. Export to PDF

```bash
wafflebase docs export "$DOC_ID" final.pdf
```

### 4. (Optional) Clean up

If the imported document was a one-off, delete it after the PDF is
saved:

```bash
wafflebase docs delete "$DOC_ID"
```

## Notes

- Korean text triggers a one-time Noto KR font download on first PDF
  export — see `docs-export-pdf.md`.
- For multi-page subsets, pass `--pages` to step 3:
  `wafflebase docs export "$DOC_ID" pp1-3.pdf --pages 1-3`.
- The intermediate Wafflebase document is the canonical source — the
  PDF is a render. If you want lasting edits, leave the document in
  place rather than deleting it.

## Safety

- Step 1 is **write** (creates a new doc).
- Step 4 (delete) is **destructive** — confirm with the user.
