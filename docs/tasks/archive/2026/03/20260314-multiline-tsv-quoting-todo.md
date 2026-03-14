---
title: Fix multiline cell copy/paste TSV quoting
created: 2026-03-14
---

# Fix multiline cell copy/paste TSV quoting

## Problem

`grid2string` and `string2grid` use naive `\n` split for row boundaries.
Cells containing newlines are split into separate rows on paste.

## Tasks

- [x] Add TSV field quoting in `grid2string` (quote fields with `\t`, `\n`, `"`)
- [x] Replace naive split in `string2grid` with quoted-field-aware parser
- [x] Add tests for multiline cell content copy/paste
- [x] Run `pnpm verify:fast` and confirm pass
