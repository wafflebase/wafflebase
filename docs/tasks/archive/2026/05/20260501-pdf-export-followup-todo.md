---
title: PDF export — font fallback and regression coverage follow-up
date: 2026-05-01
status: complete
parent: 20260501-pdf-export-parity (archived)
---

# PDF export follow-up

Split out from `20260501-pdf-export-parity` after table content parity
fixes shipped in #168 / #170 / #171.

## Remaining work

- [x] Investigate remaining font fallback / glyph issues observed after
      table content parity landed (Korean / mixed-script runs).
- [x] Add focused regression tests once the broken font/glyph cases are
      reduced to minimal repro fixtures.

## Investigation findings

The PDF painter classifies each character of a run as "Latin-safe" (drawn
with pdf-lib's WinAnsi-encoded StandardFonts) or "needs the embedded
Korean font". An exhaustive probe of every code point the painter treated
as Latin-safe found **33 characters that WinAnsi cannot actually encode** —
for those, `widthOfTextAtSize` / `drawText` *throws* (`WinAnsi cannot
encode "…"`), which aborts the **entire** export, not just one run:

1. **U+0080–U+009F (C1 controls, 32 chars).** These sit inside the
   `U+0000–U+00FF` "safe" range, but `splitMixedScript` only stripped C0
   controls + DEL (`U+0000–U+001F`, `U+007F`). A pasted/imported stray C1
   byte reached Helvetica/Times and threw.
2. **U+201B (reversed-9 quote).** The `U+2018–U+201E` "specials" range
   wrongly included it; CP1252 has no slot for U+201B, so the StandardFonts
   threw.

### Fix

- `pdf-style-map.ts`
  - Strip regex extended to C1: `[U+0000–U+001F, U+007F]` →
    `[U+0000–U+001F, U+007F–U+009F]` (C1 controls are invisible paste
    artifacts, dropped like C0).
  - `LATIN_SAFE_CHARS` quote block split around U+201B:
    `U+2018–U+201E` → `U+2018–U+201A` + `U+201C–U+201E`, so U+201B routes
    to the embedded font instead of throwing.
- `pdf-fonts.ts`
  - `LATIN_SPECIAL_CHARS` given the same U+201B carve-out so
    `scanFontsUsed` flags `needsKR` when U+201B is present — otherwise
    `resolveFontKey` would alias `kr-*` back to Helvetica and throw again.
    The two files' character classes are a documented contract.

### Verification

- New `test/export/pdf-font-fallback.test.ts`: unit coverage for C1
  stripping + U+201B routing, `scanFontsUsed` KR-embed trigger, and
  end-to-end `PdfExporter.export` no-throw for C1 / U+201B / mixed
  Korean-Latin-special runs. Tests fail on `main`, pass after the fix.
- Exhaustive re-probe after the fix: **0 throwers** across the whole
  Latin-safe range for both Helvetica and Times (was 33).
- Full `test/export/` suite green (105 tests); `pnpm verify:fast` green.

### Known limitation (accepted)

Routing U+201B to the embedded font means a doc that is otherwise pure
Latin but contains a stray U+201B now triggers the Noto KR fetch. This is
consistent with the existing design — any non-WinAnsi character (a `•`
bullet, `※`, `●`, etc.) already forces the KR embed — and is strictly
better than the pre-fix hard throw. No separate lightweight fallback font
is introduced (out of scope).

## References

- Design: [`docs/design/docs/docs-pdf-export.md`](../../design/docs/docs-pdf-export.md)
- Parent todo (archived): `docs/tasks/archive/2026/05/20260501-pdf-export-parity-todo.md`
- Parent lessons (archived): `docs/tasks/archive/2026/05/20260501-pdf-export-parity-lessons.md`
