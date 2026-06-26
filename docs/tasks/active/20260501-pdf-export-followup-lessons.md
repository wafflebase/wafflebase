# PDF export follow-up — Lessons

## WinAnsi "Latin-safe" classification must be exact

- The painter routes characters to pdf-lib StandardFonts (WinAnsi) vs the
  embedded Korean font by a `LATIN_SAFE_CHARS` character class. WinAnsi
  *throws* on any code point it can't encode, and that throw is not local
  — it aborts the whole `PdfExporter.export`. So a too-permissive safe
  class is a latent "one bad character kills the export" bug, not a
  cosmetic glyph issue.
- Two specific traps in a `U+0000–U+00FF`-style range:
  - **C1 controls (U+0080–U+009F)** look like Latin-1 but are unencodable
    controls. Strip them alongside C0/DEL; they're invisible paste
    artifacts with no layout meaning.
  - **U+201B** sits inside the obvious `U+2018–U+201E` quote range but is
    absent from CP1252. Enumerate quote ranges around it, not through it.
- Verify exhaustively, not by sampling: probing *every* code point the
  classifier called "safe" against `font.widthOfTextAtSize` /
  `encodeText` surfaced the complete 33-char set in one shot and proved
  0 throwers after the fix. Cheaper and more convincing than hand-picking
  examples.

## The scan/paint sync contract

- `scanFontsUsed` (pdf-fonts.ts) decides *which* fonts get embedded;
  `splitMixedScript`/`resolveFontKey` (pdf-style-map.ts) decide *which*
  font each run uses. If a character routes to `kr-*` at paint time but
  `scanFontsUsed` didn't flag `needsKR`, `embedAllFonts` aliases `kr-*`
  back to Helvetica and the draw throws. Any change to one file's
  character class must be mirrored in the other.

## Tooling note: invisible bytes in source

- Writing literal C1/control bytes into a file is fragile — they're
  invisible in Read output, the Edit tool can't reliably match them (it
  normalizes `\uXXXX` escapes), and they make git treat the file as
  binary. In tests, build control characters with
  `String.fromCharCode(0x90)` constants; in prose, write them in escape
  notation (`U+0080`). A quick node scan for code points in `0x00-0x1F` /
  `0x7F-0x9F` confirms no stray bytes slipped in.
- Editing a regex that already contains literal `\u` escapes: the Edit
  tool kept failing to match. A tiny `node -e` string replace on the raw
  file bytes is the reliable fallback.
