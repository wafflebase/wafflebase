---
title: formula-coverage
target-version: 0.2.0
---

# Formula Function Coverage

## Summary

Google Sheets provides approximately 500 functions across 16 categories.
Wafflebase currently implements **439 function entries (426 unique
functions + 13 aliases)** covering core, power-user, and specialist
spreadsheet needs. This document maps every Google Sheets function against
our current support status.

**Current coverage**: ~426 / ~500 unique functions (85%)

Coverage is effectively complete for daily use. The remaining gaps are:
- **Legacy aliases** (BETADIST, CHIDIST, etc.) — older names for modern
  `.DIST`/`.INV` variants we already support.
- **Byte-variant text functions** (LEFTB, RIGHTB, MIDB, etc.) — CJK
  double-byte string handling.
- **Higher-order array functions** (MAP, REDUCE, SCAN, BYROW, BYCOL,
  MAKEARRAY) — need function implementations using the existing LAMBDA
  infrastructure (grammar already supports lambda parameter binding).
- **Platform-specific** (IMPORT*, GETPIVOTDATA) — require external
  services or features we don't have.

## Current Support

| Category    | Google | Ours | Coverage |
| ----------- | -----: | ---: | -------: |
| Math        |     84 |   83 |      99% |
| Statistical |   ~130 |  103 |      79% |
| Text        |     41 |   38 |      93% |
| Date        |     26 |   25 |      96% |
| Logical     |     13 |   13 |     100% |
| Lookup      |     17 |   16 |      94% |
| Info        |     18 |   17 |      94% |
| Filter      |      4 |    3 |      75% |
| Array       |     29 |   22 |      76% |
| Financial   |     50 |   49 |      98% |
| Engineering |     47 |   42 |      89% |
| Database    |     12 |   12 |     100% |
| Operator    |     17 |    — |        — |
| Parser      |      6 |    1 |      17% |
| Web         |      8 |    3 |      38% |

Notes:
- **Operator** functions (ADD, MINUS, MULTIPLY, etc.) are covered by
  built-in arithmetic/comparison operators. CONCAT is implemented.
- **Statistical** gap is mostly legacy aliases (BETADIST, CHIDIST, etc.)
  for which we have the modern equivalents (BETA.DIST, CHISQ.DIST, etc.).
- **Web** gap is entirely IMPORT* functions (external HTTP from formula).
- **Math** gap is LOG10 only, which was removed due to an ANTLR lexer
  conflict (LOG + 10). Use `LOG(x,10)` instead.

## Implementation Approach

### Adding a new function

1. Implement in `packages/sheets/src/formula/functions.ts` — follow the
   existing `(ctx, visit, grid?) → EvalNode` pattern.
2. Register in `FunctionMap`.
3. Add catalog entry in `packages/sheets/src/formula/function-catalog.ts`
   with name, category, description, and args.
4. Add tests in `packages/sheets/test/formula/`.
5. Run `pnpm verify:fast`.

### Known parser limitations

- **LOG10**: The ANTLR lexer splits `LOG10(...)` into `LOG` (function) +
  `10` (number) because `LOG` is already a function name. Use
  `LOG(x, 10)` instead.

## Per-Function Reference

Only **not-yet-implemented** functions are listed below. All other Google
Sheets functions in each category are implemented. See `FunctionMap` in
`packages/sheets/src/formula/functions.ts` for the full list.

### Not implemented — higher-order array functions

LAMBDA and LET are implemented. These functions need implementations
that accept `LambdaNode` arguments using the existing infrastructure.

| Function   | Category | Notes                            |
| ---------- | -------- | -------------------------------- |
| MAP        | Array    | Apply lambda to each element     |
| REDUCE     | Array    | Reduce array with lambda         |
| SCAN       | Array    | Cumulative reduce with lambda    |
| BYROW      | Array    | Apply lambda to each row         |
| BYCOL      | Array    | Apply lambda to each column      |
| MAKEARRAY  | Array    | Generate array with lambda       |

### Not implemented — legacy aliases

Modern equivalents are already implemented (e.g., BETADIST → BETA.DIST).

BETADIST, BETAINV, BINOMDIST, CHIDIST, CHIINV, CHITEST, CONFIDENCE,
CRITBINOM, EXPONDIST, FDIST, FINV, FTEST, GAMMADIST, GAMMAINV,
HYPGEOMDIST, LOGINV, LOGNORMDIST, NEGBINOMDIST, NORMSDIST, NORMSINV,
POISSON, TDIST, TINV, TTEST, WEIBULL, ZTEST

### Not implemented — byte-variant text

CJK double-byte character handling. Standard (non-byte) versions are
implemented.

ASC, FINDB, LEFTB, LENB, MIDB, REPLACEB, RIGHTB, SEARCHB

### Not implemented — niche

| Function         | Category    | Notes                                |
| ---------------- | ----------- | ------------------------------------ |
| LOG10            | Math        | Removed (parser conflict). Use LOG() |
| VDB              | Financial   | Variable declining balance           |
| SORTN            | Filter      | Sort + limit (SORT works)            |
| EPOCHTODATE      | Date        | Unix timestamp conversion            |
| AVERAGE.WEIGHTED | Statistical | Weighted average                     |
| MARGINOFERROR    | Statistical | Margin of error                      |
| PEARSON          | Statistical | Same as CORREL (implemented)         |
| ISBETWEEN        | Operator    | Range check                          |
| IMCOTH           | Engineering | Complex hyperbolic cotangent         |
| IMCSCH           | Engineering | Complex hyperbolic cosecant          |
| IMLOG            | Engineering | Complex logarithm                    |
| IMSECH           | Engineering | Complex hyperbolic secant            |
| IMTANH           | Engineering | Complex hyperbolic tangent           |
| TO_DATE          | Parser      | Type conversion                      |
| TO_DOLLARS       | Parser      | Type conversion                      |
| TO_PERCENT       | Parser      | Type conversion                      |
| TO_PURE_NUMBER   | Parser      | Type conversion                      |
| TO_TEXT          | Parser      | Type conversion                      |

### Out of scope

| Function                       | Reason                           |
| ------------------------------ | -------------------------------- |
| IMPORTDATA/FEED/HTML/RANGE/XML | External HTTP from formula       |
| GETPIVOTDATA                   | Requires pivot table feature     |
| ISEMAIL                        | Validation utility, low priority |
| ARRAY_CONSTRAIN                | Dynamic array control, low demand|
| Operator functions (ADD, MINUS, MULTIPLY, etc.) | Covered by built-in operators |
