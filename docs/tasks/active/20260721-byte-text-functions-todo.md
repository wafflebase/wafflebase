# TODO — ECMA byte-oriented text functions (#278)

Issue: [#278](https://github.com/.../issues/278) — Support `LEFTB`, `RIGHTB`,
`MIDB`, `LENB`, `FINDB`, `SEARCHB`, `REPLACEB`, `ASC`.

Not an architecture change: adds function implementations + catalog entries
following the existing text-function pattern in
`packages/sheets/src/formula/functions-text.ts`. ~1 PR, `pnpm verify:fast`
green. No grammar change needed — `FUNCNAME` already matches these names.

## Behaviour (from the issue)

- `LENB(s)` — UTF-8 byte length of `s` (`LENB("café") = 5`).
- `LEFTB(s, [n])` — longest prefix whose UTF-8 byte length ≤ `n`, split at
  character boundaries (default `n = 1`).
- `RIGHTB(s, [n])` — longest suffix, same rule.
- `MIDB(s, start, len)` — characters whose byte span is fully within the
  `[start, start+len)` byte window (1-indexed byte `start`).
- `FINDB(needle, haystack, [start])` — case-sensitive search; `start` and the
  returned position are byte offsets (1-indexed).
- `SEARCHB(needle, haystack, [start])` — case-insensitive + wildcard, byte
  offsets.
- `REPLACEB(old, start, len, new)` — replace the `len`-byte window at byte
  `start` with `new`; chars overlapping the window are removed.
- `ASC(s)` — full-width → half-width: `U+FF01–U+FF5E` (offset `-0xFEE0`),
  ideographic space `U+3000 → U+0020`, and full-width katakana → half-width
  katakana (table, voiced/semi-voiced expand to base + `ﾞ`/`ﾟ`).

For pure ASCII every B-function equals its non-B sibling.

## Tasks

- [ ] Add byte helpers + 8 function impls to `functions-text.ts`; register in
      `textEntries`.
- [ ] Add catalog entries (Text category) in `function-catalog.ts` so arity
      validation passes and autocomplete lists them.
- [ ] Unit tests in `packages/sheets/test/formula/formula.test.ts` covering the
      issue's acceptance table + multibyte cases.
- [ ] Update `docs/design/sheets/formula-coverage.md` (move the 8 out of "Not
      implemented — byte-variant text"; bump counts).
- [ ] Land DRAFT PR, let CI verify.

## Done when

- Acceptance table in the issue passes; `pnpm verify:fast` (CI) green.
