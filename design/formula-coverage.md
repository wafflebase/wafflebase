---
title: formula-coverage
target-version: 0.2.0
---

# Formula Function Coverage

## Summary

Google Sheets provides approximately 500 functions across 16 categories.
Wafflebase currently implements **437 function entries (424 unique
functions + 13 aliases)** covering core, power-user, and specialist
spreadsheet needs. This document maps every Google Sheets function against
our current support status.

**Current coverage**: ~424 / ~500 unique functions (85%)

Coverage is effectively complete for daily use. The remaining gaps are:
- **Legacy aliases** (BETADIST, CHIDIST, etc.) — older names for modern
  `.DIST`/`.INV` variants we already support.
- **Byte-variant text functions** (LEFTB, RIGHTB, MIDB, etc.) — CJK
  double-byte string handling.
- **Higher-order functions** (LET, LAMBDA, MAP, REDUCE, SCAN, BYROW,
  BYCOL) — require ANTLR grammar extensions for lambda parameter binding.
- **Platform-specific** (IMPORT*, GETPIVOTDATA) — require external
  services or features we don't have.

## Current Support

| Category    | Google | Ours | Coverage |
| ----------- | -----: | ---: | -------: |
| Math        |     84 |   83 |      99% |
| Statistical |   ~130 |  103 |      79% |
| Text        |     41 |   38 |      93% |
| Date        |     26 |   25 |      96% |
| Logical     |     13 |   11 |      85% |
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

## Remaining Gaps

### Higher-order functions (require grammar changes)

LET, LAMBDA, MAP, REDUCE, SCAN, BYROW, BYCOL, MAKEARRAY — these require
the ANTLR grammar to support named parameter binding and lambda
expressions. This is the largest architectural gap.

### Legacy statistical aliases

BETADIST, BETAINV, BINOMDIST, CHIDIST, CHIINV, CHITEST, CRITBINOM,
EXPONDIST, FDIST, FINV, FTEST, GAMMADIST, GAMMAINV, HYPGEOMDIST, LOGINV,
LOGNORMDIST, NEGBINOMDIST, NORMSDIST, NORMSINV, POISSON, TDIST, TINV,
TTEST, WEIBULL, ZTEST — older names that map to modern functions we already
support (e.g., BETADIST → BETA.DIST).

### Byte-variant text functions

ASC, FINDB, LEFTB, LENB, MIDB, REPLACEB, RIGHTB, SEARCHB — CJK
double-byte character handling variants.

### Niche missing functions

| Function        | Category    | Notes                                |
| --------------- | ----------- | ------------------------------------ |
| LOG10           | Math        | Removed (parser conflict). Use LOG() |
| VDB             | Financial   | Variable declining balance           |
| SORTN           | Filter      | Sort + limit (SORT works)            |
| EPOCHTODATE     | Date        | Unix timestamp conversion            |
| AVERAGE.WEIGHTED| Statistical | Weighted average                     |
| MARGINOFERROR   | Statistical | Margin of error                      |
| PEARSON         | Statistical | Same as CORREL (implemented)         |
| ISBETWEEN       | Operator    | Range check                          |
| IMCOTH          | Engineering | Complex hyperbolic cotangent         |
| IMCSCH          | Engineering | Complex hyperbolic cosecant          |
| IMLOG           | Engineering | Complex logarithm                    |
| IMSECH          | Engineering | Complex hyperbolic secant            |
| IMTANH          | Engineering | Complex hyperbolic tangent           |
| TO_DATE         | Parser      | Type conversion                      |
| TO_DOLLARS      | Parser      | Type conversion                      |
| TO_PERCENT      | Parser      | Type conversion                      |
| TO_PURE_NUMBER  | Parser      | Type conversion                      |
| TO_TEXT         | Parser      | Type conversion                      |

### Out of Scope

| Function               | Reason                             |
| ---------------------- | ---------------------------------- |
| IMPORTDATA/FEED/HTML/RANGE/XML | External HTTP from formula |
| GETPIVOTDATA           | Requires pivot table feature       |
| ISEMAIL                | Validation utility, low priority   |
| ARRAY_CONSTRAIN        | Dynamic array control, low demand  |

## Implementation Approach

### Adding a new function

1. Implement in `packages/sheet/src/formula/functions.ts` — follow the
   existing `(ctx, visit, grid?) → EvalNode` pattern.
2. Register in `FunctionMap`.
3. Add catalog entry in `packages/sheet/src/formula/function-catalog.ts`
   with name, category, description, and args.
4. Add tests in `packages/sheet/test/formula/`.
5. Run `pnpm verify:fast`.

### Known parser limitations

- **LOG10**: The ANTLR lexer splits `LOG10(...)` into `LOG` (function) +
  `10` (number) because `LOG` is already a function name. Use
  `LOG(x, 10)` instead.
- **LAMBDA/LET**: Require grammar extensions for named parameter binding.
  Not planned for the current parser architecture.

## Per-Function Reference

Complete mapping of every Google Sheets function to its support status.

Legend: ✅ = implemented, 🟡 = planned (Tier 2), 🟠 = planned (Tier 3),
⬜ = out of scope

### Array

| Function | Status |
| --- | --- |
| ARRAY_CONSTRAIN | ⬜ |
| BYCOL | 🟡 |
| BYROW | 🟡 |
| CHOOSECOLS | ✅ |
| CHOOSEROWS | ✅ |
| FLATTEN | ✅ |
| FREQUENCY | ✅ |
| GROWTH | ✅ |
| HSTACK | ✅ |
| LINEST | ✅ |
| LOGEST | ✅ |
| MAKEARRAY | 🟡 |
| MAP | 🟡 |
| MDETERM | ✅ |
| MINVERSE | ✅ |
| MMULT | ✅ |
| REDUCE | 🟡 |
| SCAN | 🟡 |
| SUMPRODUCT | ✅ |
| SUMX2MY2 | ✅ |
| SUMX2PY2 | ✅ |
| SUMXMY2 | ✅ |
| TOCOL | ✅ |
| TOROW | ✅ |
| TRANSPOSE | ✅ |
| TREND | ✅ |
| VSTACK | ✅ |
| WRAPCOLS | ✅ |
| WRAPROWS | ✅ |

### Database

| Function | Status |
| --- | --- |
| DAVERAGE | ✅ |
| DCOUNT | ✅ |
| DCOUNTA | ✅ |
| DGET | ✅ |
| DMAX | ✅ |
| DMIN | ✅ |
| DPRODUCT | ✅ |
| DSTDEV | ✅ |
| DSTDEVP | ✅ |
| DSUM | ✅ |
| DVAR | ✅ |
| DVARP | ✅ |

### Date

| Function | Status |
| --- | --- |
| DATE | ✅ |
| DATEDIF | ✅ |
| DATEVALUE | ✅ |
| DAY | ✅ |
| DAYS | ✅ |
| DAYS360 | ✅ |
| EDATE | ✅ |
| EOMONTH | ✅ |
| EPOCHTODATE | 🟡 |
| HOUR | ✅ |
| ISOWEEKNUM | ✅ |
| MINUTE | ✅ |
| MONTH | ✅ |
| NETWORKDAYS | ✅ |
| NETWORKDAYS.INTL | ✅ |
| NOW | ✅ |
| SECOND | ✅ |
| TIME | ✅ |
| TIMEVALUE | ✅ |
| TODAY | ✅ |
| WEEKDAY | ✅ |
| WEEKNUM | ✅ |
| WORKDAY | ✅ |
| WORKDAY.INTL | ✅ |
| YEAR | ✅ |
| YEARFRAC | ✅ |

### Engineering

| Function | Status |
| --- | --- |
| BIN2DEC | ✅ |
| BIN2HEX | ✅ |
| BIN2OCT | ✅ |
| BITAND | ✅ |
| BITLSHIFT | ✅ |
| BITOR | ✅ |
| BITRSHIFT | ✅ |
| BITXOR | ✅ |
| COMPLEX | ✅ |
| DEC2BIN | ✅ |
| DEC2HEX | ✅ |
| DEC2OCT | ✅ |
| DELTA | ✅ |
| ERF | ✅ |
| ERF.PRECISE | ✅ |
| GESTEP | ✅ |
| HEX2BIN | ✅ |
| HEX2DEC | ✅ |
| HEX2OCT | ✅ |
| IMABS | ✅ |
| IMAGINARY | ✅ |
| IMARGUMENT | ✅ |
| IMCONJUGATE | ✅ |
| IMCOS | ✅ |
| IMCOSH | ✅ |
| IMCOT | ✅ |
| IMCOTH | 🟠 |
| IMCSC | ✅ |
| IMCSCH | 🟠 |
| IMDIV | ✅ |
| IMEXP | ✅ |
| IMLOG | 🟠 |
| IMLOG10 | ✅ |
| IMLOG2 | ✅ |
| IMPRODUCT | ✅ |
| IMREAL | ✅ |
| IMSEC | ✅ |
| IMSECH | 🟠 |
| IMSIN | ✅ |
| IMSINH | ✅ |
| IMSUB | ✅ |
| IMSUM | ✅ |
| IMTAN | ✅ |
| IMTANH | 🟠 |
| OCT2BIN | ✅ |
| OCT2DEC | ✅ |
| OCT2HEX | ✅ |

### Filter

| Function | Status |
| --- | --- |
| FILTER | ✅ |
| SORT | ✅ |
| SORTN | 🟡 |
| UNIQUE | ✅ |

### Financial

| Function | Status |
| --- | --- |
| ACCRINT | ✅ |
| ACCRINTM | ✅ |
| AMORLINC | ✅ |
| COUPDAYBS | ✅ |
| COUPDAYS | ✅ |
| COUPDAYSNC | ✅ |
| COUPNCD | ✅ |
| COUPNUM | ✅ |
| COUPPCD | ✅ |
| CUMIPMT | ✅ |
| CUMPRINC | ✅ |
| DB | ✅ |
| DDB | ✅ |
| DISC | ✅ |
| DOLLARDE | ✅ |
| DOLLARFR | ✅ |
| DURATION | ✅ |
| EFFECT | ✅ |
| FV | ✅ |
| FVSCHEDULE | ✅ |
| INTRATE | ✅ |
| IPMT | ✅ |
| IRR | ✅ |
| ISPMT | ✅ |
| MDURATION | ✅ |
| MIRR | ✅ |
| NOMINAL | ✅ |
| NPER | ✅ |
| NPV | ✅ |
| PDURATION | ✅ |
| PMT | ✅ |
| PPMT | ✅ |
| PRICE | ✅ |
| PRICEDISC | ✅ |
| PRICEMAT | ✅ |
| PV | ✅ |
| RATE | ✅ |
| RECEIVED | ✅ |
| RRI | ✅ |
| SLN | ✅ |
| SYD | ✅ |
| TBILLEQ | ✅ |
| TBILLPRICE | ✅ |
| TBILLYIELD | ✅ |
| VDB | 🟠 |
| XIRR | ✅ |
| XNPV | ✅ |
| YIELD | ✅ |
| YIELDDISC | ✅ |
| YIELDMAT | ✅ |

### Info

| Function | Status |
| --- | --- |
| CELL | ✅ |
| ERROR.TYPE | ✅ |
| ISBLANK | ✅ |
| ISDATE | ✅ |
| ISEMAIL | ⬜ |
| ISERR | ✅ |
| ISERROR | ✅ |
| ISFORMULA | ✅ |
| ISLOGICAL | ✅ |
| ISNA | ✅ |
| ISNONTEXT | ✅ |
| ISNUMBER | ✅ |
| ISREF | ✅ |
| ISTEXT | ✅ |
| N | ✅ |
| NA | ✅ |
| SHEETS | ✅ |
| TYPE | ✅ |

### Logical

| Function | Status |
| --- | --- |
| AND | ✅ |
| FALSE | ✅ |
| IF | ✅ |
| IFERROR | ✅ |
| IFNA | ✅ |
| IFS | ✅ |
| LAMBDA | 🟡 |
| LET | 🟡 |
| NOT | ✅ |
| OR | ✅ |
| SWITCH | ✅ |
| TRUE | ✅ |
| XOR | ✅ |

### Lookup

| Function | Status |
| --- | --- |
| ADDRESS | ✅ |
| CHOOSE | ✅ |
| COLUMN | ✅ |
| COLUMNS | ✅ |
| FORMULATEXT | ✅ |
| GETPIVOTDATA | ⬜ |
| HLOOKUP | ✅ |
| INDEX | ✅ |
| INDIRECT | ✅ |
| LOOKUP | ✅ |
| MATCH | ✅ |
| OFFSET | ✅ |
| ROW | ✅ |
| ROWS | ✅ |
| SHEET | ✅ |
| VLOOKUP | ✅ |
| XLOOKUP | ✅ |

### Math

| Function | Status |
| --- | --- |
| ABS | ✅ |
| ACOS | ✅ |
| ACOSH | ✅ |
| ACOT | ✅ |
| ACOTH | ✅ |
| ASIN | ✅ |
| ASINH | ✅ |
| ATAN | ✅ |
| ATAN2 | ✅ |
| ATANH | ✅ |
| BASE | ✅ |
| CEILING | ✅ |
| CEILING.MATH | ✅ |
| CEILING.PRECISE | ✅ |
| COMBIN | ✅ |
| COMBINA | ✅ |
| COS | ✅ |
| COSH | ✅ |
| COT | ✅ |
| COTH | ✅ |
| COUNTBLANK | ✅ |
| COUNTIF | ✅ |
| COUNTIFS | ✅ |
| COUNTUNIQUE | ✅ |
| CSC | ✅ |
| CSCH | ✅ |
| DECIMAL | ✅ |
| DEGREES | ✅ |
| ERFC | ✅ |
| ERFC.PRECISE | ✅ |
| EVEN | ✅ |
| EXP | ✅ |
| FACT | ✅ |
| FACTDOUBLE | ✅ |
| FLOOR | ✅ |
| FLOOR.MATH | ✅ |
| FLOOR.PRECISE | ✅ |
| GAMMALN | ✅ |
| GAMMALN.PRECISE | ✅ |
| GCD | ✅ |
| IMLN | ✅ |
| IMPOWER | ✅ |
| IMSQRT | ✅ |
| INT | ✅ |
| ISEVEN | ✅ |
| ISO.CEILING | ✅ |
| ISODD | ✅ |
| LCM | ✅ |
| LN | ✅ |
| LOG | ✅ |
| LOG10 | ⬜ |
| MOD | ✅ |
| MROUND | ✅ |
| MULTINOMIAL | ✅ |
| MUNIT | ✅ |
| ODD | ✅ |
| PI | ✅ |
| POWER | ✅ |
| PRODUCT | ✅ |
| QUOTIENT | ✅ |
| RADIANS | ✅ |
| RAND | ✅ |
| RANDARRAY | ✅ |
| RANDBETWEEN | ✅ |
| ROUND | ✅ |
| ROUNDDOWN | ✅ |
| ROUNDUP | ✅ |
| SEC | ✅ |
| SECH | ✅ |
| SEQUENCE | ✅ |
| SERIESSUM | ✅ |
| SIGN | ✅ |
| SIN | ✅ |
| SINH | ✅ |
| SQRT | ✅ |
| SQRTPI | ✅ |
| SUBTOTAL | ✅ |
| SUM | ✅ |
| SUMIF | ✅ |
| SUMIFS | ✅ |
| SUMSQ | ✅ |
| TAN | ✅ |
| TANH | ✅ |
| TRUNC | ✅ |

### Operator

| Function | Status |
| --- | --- |
| ADD | ⬜ |
| CONCAT | ✅ |
| DIVIDE | ⬜ |
| EQ | ⬜ |
| GT | ⬜ |
| GTE | ⬜ |
| ISBETWEEN | 🟡 |
| LT | ⬜ |
| LTE | ⬜ |
| MINUS | ⬜ |
| MULTIPLY | ⬜ |
| NE | ⬜ |
| POW | ⬜ |
| UMINUS | ⬜ |
| UNARY_PERCENT | ⬜ |
| UNIQUE | ✅ |
| UPLUS | ⬜ |

### Parser

| Function | Status |
| --- | --- |
| CONVERT | ✅ |
| TO_DATE | 🟡 |
| TO_DOLLARS | 🟡 |
| TO_PERCENT | 🟡 |
| TO_PURE_NUMBER | 🟡 |
| TO_TEXT | 🟡 |

### Statistical

| Function | Status |
| --- | --- |
| AVEDEV | ✅ |
| AVERAGE | ✅ |
| AVERAGE.WEIGHTED | 🟡 |
| AVERAGEA | ✅ |
| AVERAGEIF | ✅ |
| AVERAGEIFS | ✅ |
| BETA.DIST | ✅ |
| BETA.INV | ✅ |
| BETADIST | 🟠 |
| BETAINV | 🟠 |
| BINOM.DIST | ✅ |
| BINOM.DIST.RANGE | ✅ |
| BINOM.INV | ✅ |
| BINOMDIST | 🟠 |
| CHIDIST | 🟠 |
| CHIINV | 🟠 |
| CHISQ.DIST | ✅ |
| CHISQ.DIST.RT | ✅ |
| CHISQ.INV | ✅ |
| CHISQ.INV.RT | ✅ |
| CHISQ.TEST | ✅ |
| CHITEST | 🟠 |
| CONFIDENCE | 🟠 |
| CONFIDENCE.NORM | ✅ |
| CONFIDENCE.T | ✅ |
| CORREL | ✅ |
| COUNT | ✅ |
| COUNTA | ✅ |
| COVAR | ✅ |
| COVARIANCE.P | ✅ |
| COVARIANCE.S | ✅ |
| CRITBINOM | 🟠 |
| DEVSQ | ✅ |
| EXPON.DIST | ✅ |
| EXPONDIST | 🟠 |
| F.DIST | ✅ |
| F.DIST.RT | ✅ |
| F.INV | ✅ |
| F.INV.RT | ✅ |
| F.TEST | ✅ |
| FDIST | 🟠 |
| FINV | 🟠 |
| FISHER | ✅ |
| FISHERINV | ✅ |
| FORECAST | ✅ |
| FORECAST.LINEAR | ✅ |
| FTEST | 🟠 |
| GAMMA | ✅ |
| GAMMA.DIST | ✅ |
| GAMMA.INV | ✅ |
| GAMMADIST | 🟠 |
| GAMMAINV | 🟠 |
| GAUSS | ✅ |
| GEOMEAN | ✅ |
| HARMEAN | ✅ |
| HYPGEOM.DIST | ✅ |
| HYPGEOMDIST | 🟠 |
| INTERCEPT | ✅ |
| KURT | ✅ |
| LARGE | ✅ |
| LOGINV | 🟠 |
| LOGNORM.DIST | ✅ |
| LOGNORM.INV | ✅ |
| LOGNORMDIST | 🟠 |
| MARGINOFERROR | 🟠 |
| MAX | ✅ |
| MAXA | ✅ |
| MAXIFS | ✅ |
| MEDIAN | ✅ |
| MIN | ✅ |
| MINA | ✅ |
| MINIFS | ✅ |
| MODE | ✅ |
| MODE.MULT | ✅ |
| MODE.SNGL | ✅ |
| NEGBINOM.DIST | ✅ |
| NEGBINOMDIST | 🟠 |
| NORM.DIST | ✅ |
| NORM.INV | ✅ |
| NORM.S.DIST | ✅ |
| NORM.S.INV | ✅ |
| NORMDIST | ✅ |
| NORMINV | ✅ |
| NORMSDIST | 🟠 |
| NORMSINV | 🟠 |
| PEARSON | 🟡 |
| PERCENTILE | ✅ |
| PERCENTILE.EXC | ✅ |
| PERCENTILE.INC | ✅ |
| PERCENTRANK | ✅ |
| PERCENTRANK.EXC | ✅ |
| PERCENTRANK.INC | ✅ |
| PERMUT | ✅ |
| PERMUTATIONA | ✅ |
| PHI | ✅ |
| POISSON | 🟠 |
| POISSON.DIST | ✅ |
| PROB | ✅ |
| QUARTILE | ✅ |
| QUARTILE.EXC | ✅ |
| QUARTILE.INC | ✅ |
| RANK | ✅ |
| RANK.AVG | ✅ |
| RANK.EQ | ✅ |
| RSQ | ✅ |
| SKEW | ✅ |
| SKEW.P | ✅ |
| SLOPE | ✅ |
| SMALL | ✅ |
| STANDARDIZE | ✅ |
| STDEV | ✅ |
| STDEV.P | ✅ |
| STDEV.S | ✅ |
| STDEVA | ✅ |
| STDEVP | ✅ |
| STDEVPA | ✅ |
| STEYX | ✅ |
| T.DIST | ✅ |
| T.DIST.2T | ✅ |
| T.DIST.RT | ✅ |
| T.INV | ✅ |
| T.INV.2T | ✅ |
| T.TEST | ✅ |
| TDIST | 🟠 |
| TINV | 🟠 |
| TRIMMEAN | ✅ |
| TTEST | 🟠 |
| VAR | ✅ |
| VAR.P | ✅ |
| VAR.S | ✅ |
| VARA | ✅ |
| VARP | ✅ |
| VARPA | ✅ |
| WEIBULL | 🟠 |
| WEIBULL.DIST | ✅ |
| Z.TEST | ✅ |
| ZTEST | 🟠 |

### Text

| Function | Status |
| --- | --- |
| ARABIC | ✅ |
| ASC | 🟡 |
| CHAR | ✅ |
| CLEAN | ✅ |
| CODE | ✅ |
| CONCATENATE | ✅ |
| DOLLAR | ✅ |
| EXACT | ✅ |
| FIND | ✅ |
| FINDB | 🟡 |
| FIXED | ✅ |
| JOIN | ✅ |
| LEFT | ✅ |
| LEFTB | 🟡 |
| LEN | ✅ |
| LENB | 🟡 |
| LOWER | ✅ |
| MID | ✅ |
| MIDB | 🟡 |
| PROPER | ✅ |
| REGEXEXTRACT | ✅ |
| REGEXMATCH | ✅ |
| REGEXREPLACE | ✅ |
| REPLACE | ✅ |
| REPLACEB | 🟡 |
| REPT | ✅ |
| RIGHT | ✅ |
| RIGHTB | 🟡 |
| ROMAN | ✅ |
| SEARCH | ✅ |
| SEARCHB | 🟡 |
| SPLIT | ✅ |
| SUBSTITUTE | ✅ |
| T | ✅ |
| TEXT | ✅ |
| TEXTJOIN | ✅ |
| TRIM | ✅ |
| UNICHAR | ✅ |
| UNICODE | ✅ |
| UPPER | ✅ |
| VALUE | ✅ |

### Web

| Function | Status |
| --- | --- |
| ENCODEURL | ✅ |
| HYPERLINK | ✅ |
| IMPORTDATA | ⬜ |
| IMPORTFEED | ⬜ |
| IMPORTHTML | ⬜ |
| IMPORTRANGE | ⬜ |
| IMPORTXML | ⬜ |
| ISURL | ✅ |

### Additional Functions (not in Google Sheets)

These functions are implemented but have no Google Sheets equivalent:

| Function | Category | Description |
| --- | --- | --- |
| AREAS | Info | Number of areas in a reference |
| BESSELJ | Engineering | Bessel function of the first kind |
| BESSELY | Engineering | Bessel function of the second kind |
| BESSELI | Engineering | Modified Bessel function (first kind) |
| BESSELK | Engineering | Modified Bessel function (second kind) |
| AGGREGATE | Statistical | Aggregate with ignore options |
| CELL | Info | Cell information (row, col, address) |
| CHOOSEROWS | Lookup | Select rows from array |
| CHOOSECOLS | Lookup | Select columns from array |
| DROP | Lookup | Remove rows/columns from array |
| EXPAND | Lookup | Expand array dimensions |
| FILTER | Lookup | Filter rows by criteria |
| NUMBERVALUE | Text | Parse localized number string |
| SORTBY | Lookup | Sort by separate key array |
| TAKE | Lookup | Take rows/columns from array |
| TEXTBEFORE | Text | Text before delimiter |
| TEXTAFTER | Text | Text after delimiter |
| TEXTSPLIT | Text | Split text by delimiter |
| VALUETOTEXT | Text | Convert value to text |
| XMATCH | Lookup | Modern MATCH with match modes |
