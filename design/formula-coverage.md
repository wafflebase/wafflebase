---
title: formula-coverage
target-version: 0.2.0
---

# Formula Function Coverage Plan

## Summary

Google Sheets provides approximately 500 functions across 16 categories.
Wafflebase currently implements **189 function entries (165+ unique
functions)** covering core spreadsheet needs plus many power-user
functions. This document maps every Google Sheets function against our
current support status and defines a phased plan to close the gap where it
matters most.

**Current coverage**: ~165 / ~500 (33%)

The goal is not 100% parity. We prioritize the functions that real users reach
for daily, then progressively add power-user and specialist functions.

## Current Support

| Category    | Google | Ours | Coverage |
| ----------- | -----: | ---: | -------: |
| Math        |     84 |   50 |      60% |
| Statistical |   ~130 |   28 |      22% |
| Text        |     41 |   28 |      68% |
| Date        |     26 |   22 |      85% |
| Logical     |     13 |   10 |      77% |
| Lookup      |     17 |   14 |      82% |
| Info        |     18 |   13 |      72% |
| Filter      |      4 |    0 |       0% |
| Array       |     29 |    1 |       3% |
| Financial   |     50 |    0 |       0% |
| Engineering |     47 |    0 |       0% |
| Operator    |     17 |    0 |       — |
| Database    |     12 |    0 |       0% |
| Parser      |      6 |    0 |       0% |
| Web         |      8 |    0 |       0% |

Notes:
- **Operator** functions (ADD, MINUS, MULTIPLY, etc.) are already covered by
  our arithmetic/comparison operators. CONCAT is implemented. Low priority.

## Tier 1 — Everyday Essentials

Functions most users expect in any spreadsheet. Highest impact, implement
first. Each sub-section lists what we already have (✅) and what to add.

### Math (add 27)

✅ SUM, ABS, ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, SQRT, POWER, PRODUCT,
   RAND, RANDBETWEEN

Add:
- **Rounding/truncation**: CEILING, FLOOR, TRUNC, MROUND, EVEN, ODD
- **Logarithms/exp**: LOG, LOG10, LN, EXP
- **Trigonometry basics**: PI, SIN, COS, TAN, ASIN, ACOS, ATAN, ATAN2,
  DEGREES, RADIANS
- **Arithmetic**: SIGN, QUOTIENT, SUMSQ, SUMPRODUCT
- **Combinatorics**: FACT, COMBIN

### Statistical (add 19)

✅ AVERAGE, MIN, MAX, COUNT, COUNTA, MEDIAN

Add:
- **Conditional aggregation**: AVERAGEIF, AVERAGEIFS, MAXIFS, MINIFS,
  COUNTUNIQUE
- **Descriptive stats**: STDEV, STDEVP, VAR, VARP, MODE
- **Ranking/percentile**: LARGE, SMALL, RANK, PERCENTILE, QUARTILE
- **Regression basics**: FORECAST, SLOPE, INTERCEPT, CORREL

### Text (add 14)

✅ TRIM, LEN, LEFT, RIGHT, MID, CONCATENATE, CONCAT, FIND, SEARCH,
   TEXTJOIN, LOWER, UPPER, PROPER, SUBSTITUTE

Add:
- **Conversion**: TEXT, VALUE, CHAR, CODE, FIXED, DOLLAR
- **Manipulation**: REPLACE, REPT, CLEAN, EXACT, SPLIT, JOIN, T
- **Pattern matching**: REGEXMATCH

### Date (add 10)

✅ TODAY, NOW, DATE, TIME, DAYS, YEAR, MONTH, DAY, HOUR, MINUTE, SECOND,
   WEEKDAY

Add:
- **Parsing/conversion**: DATEDIF, DATEVALUE, TIMEVALUE
- **Shifting**: EDATE, EOMONTH, WORKDAY, NETWORKDAYS
- **Week**: WEEKNUM, ISOWEEKNUM
- **Financial calendar**: YEARFRAC

### Logical (add 4)

✅ IF, IFS, SWITCH, AND, OR, NOT, IFERROR, IFNA

Add:
- TRUE, FALSE, XOR
- LET (named sub-expressions — modern formula feature)

### Lookup (add 9)

✅ MATCH, INDEX, VLOOKUP, HLOOKUP

Add:
- **Modern lookup**: XLOOKUP
- **Position utilities**: ROW, COLUMN, ROWS, COLUMNS
- **Reference builders**: ADDRESS, INDIRECT, OFFSET, CHOOSE
- **Search**: LOOKUP

### Info (add 5)

✅ ISBLANK, ISNUMBER, ISTEXT, ISERROR, ISERR, ISNA, ISLOGICAL, ISNONTEXT

Add:
- TYPE, N, NA, ERROR.TYPE, ISDATE

### Filter / Array (add 5)

Add:
- FILTER, SORT, UNIQUE, TRANSPOSE
- SUMPRODUCT (if not already counted under Math)

**Tier 1 total: ~93 new functions → brings us to ~163 (33% coverage)**

These cover the vast majority of what typical spreadsheet users need.

## Tier 2 — Power User

Functions that experienced users and business analysts expect. Implement
after Tier 1 is stable.

### Financial basics (add 15)

PMT, FV, PV, NPV, IRR, RATE, NPER, IPMT, PPMT, XNPV, XIRR, SLN, DB,
DDB, EFFECT

### Extended math (add 12)

CEILING.MATH, FLOOR.MATH, SUBTOTAL, MULTINOMIAL, GCD, LCM, FACTDOUBLE,
SQRTPI, BASE, DECIMAL, ISEVEN, ISODD

### Extended statistical (add 15)

AVERAGEA, MAXA, MINA, STDEVA, STDEVPA, VARA, VARPA, PERCENTILE.EXC,
RANK.AVG, RANK.EQ, TRIMMEAN, GEOMEAN, HARMEAN, AVEDEV, DEVSQ

### Extended text (add 10)

REGEXEXTRACT, REGEXREPLACE, ROMAN, ARABIC, UNICODE, UNICHAR, ASC,
LEFTB, RIGHTB, MIDB

### Extended date (add 4)

DAYS360, WORKDAY.INTL, NETWORKDAYS.INTL, EPOCHTODATE

### Extended lookup (add 4)

FORMULATEXT, OFFSET (if not in Tier 1), ROW, SHEET

### Array functions (add 8)

FLATTEN, FREQUENCY, HSTACK, VSTACK, TOCOL, TOROW, WRAPCOLS, WRAPROWS

### Parser functions (add 5)

CONVERT, TO_DATE, TO_TEXT, TO_PERCENT, TO_PURE_NUMBER

### LAMBDA ecosystem (add 6)

LAMBDA, MAP, REDUCE, SCAN, BYROW, BYCOL

**Tier 2 total: ~79 new functions → cumulative ~242 (48% coverage)**

## Tier 3 — Specialist

Niche functions for domain-specific work. Add on demand or as community
contributions.

### Full financial suite (add ~35)

Remaining bond/coupon functions (ACCRINT, COUPDAYBS, PRICE, YIELD, etc.),
depreciation (VDB, SYD, AMORLINC), and TVM variants (CUMIPMT, CUMPRINC,
MIRR, FVSCHEDULE, etc.).

### Statistical distributions (add ~60)

NORMDIST, NORMINV, TDIST, TINV, CHISQ.DIST, BINOM.DIST, POISSON.DIST,
F.DIST, BETA.DIST, GAMMA.DIST, WEIBULL, LOGNORMDIST, HYPGEOMDIST,
EXPONDIST, etc. — including all `.INV`, `.RT`, `.2T` variants and legacy
aliases.

### Statistical tests (add ~10)

T.TEST, F.TEST, CHISQ.TEST, Z.TEST, CONFIDENCE, CONFIDENCE.T, FISHER,
FISHERINV, PROB, MARGINOFERROR.

### Engineering (add ~47)

Number base conversions (BIN2DEC, HEX2OCT, etc.), bitwise operations
(BITAND, BITOR, BITXOR), complex number arithmetic (IMSUM, IMDIV,
IMCOS, etc.), error functions (ERF, ERFC), and threshold functions
(DELTA, GESTEP).

### Database functions (add 12)

DAVERAGE, DCOUNT, DCOUNTA, DGET, DMAX, DMIN, DPRODUCT, DSTDEV, DSTDEVP,
DSUM, DVAR, DVARP.

### Matrix functions (add 5)

MDETERM, MINVERSE, MMULT, MUNIT, LINEST.

**Tier 3 total: ~170 functions → cumulative ~412 (81% coverage)**

## Out of Scope

These functions are platform-specific or require external services. Not
planned.

| Function          | Reason                             |
| ----------------- | ---------------------------------- |
| IMPORTDATA/FEED/HTML/RANGE/XML | External HTTP from formula |
| GETPIVOTDATA      | Requires pivot table feature       |
| CELL              | Implementation-specific metadata   |
| ISFORMULA / ISREF | Requires formula-aware cell checks |
| ISEMAIL / ISURL   | Validation utilities, low priority |
| SHEETS / SHEET    | Multi-sheet metadata queries       |

Operator functions (ADD, MINUS, MULTIPLY, DIVIDE, EQ, GT, LT, etc.) are
already handled by built-in operators and are not worth duplicating as
named functions.

## Implementation Approach

### Adding a new function

1. Implement in `packages/sheet/src/formula/functions.ts` — follow the
   existing `(ctx, visit, grid?) → EvalNode` pattern.
2. Register in `FunctionMap`.
3. Add catalog entry in `packages/sheet/src/formula/function-catalog.ts` with name, category,
   description, and args.
4. Add tests in `packages/sheet/test/formula/`.
5. Run `pnpm verify:fast`.

### Batching strategy

Group functions by shared infrastructure:

- **Trig functions** share the same single-number-arg pattern.
- **Rounding variants** (CEILING, FLOOR, MROUND, TRUNC) share rounding logic.
- **Conditional aggregations** (AVERAGEIF, MAXIFS, MINIFS) extend the existing
  COUNTIF/SUMIF pattern.
- **XLOOKUP** can reuse MATCH internals.
- **STDEV/VAR family** share sum-of-squares accumulation.

Each batch should be a single commit with tests.

### Grammar changes

Most new functions require **no grammar changes** — the grammar already
supports `FUNCNAME '(' args ')'`. Functions like LET and LAMBDA may
require grammar extensions for named parameter binding.

### Date system prerequisite

Several Tier 1 date functions (DATEDIF, EDATE, EOMONTH, WORKDAY,
NETWORKDAYS) require a proper serial date number system (days since epoch)
to match Google Sheets behavior. Currently dates are stored as strings.
A date serial number system is a prerequisite for robust date arithmetic.

## Per-Function Reference

Complete mapping of every Google Sheets function to its support status.

Legend: ✅ = supported, 🔵 = Tier 1, 🟡 = Tier 2, 🟠 = Tier 3, ⬜ = out of scope

### Array

| Function | Status |
| --- | --- |
| ARRAY_CONSTRAIN | 🟠 |
| BYCOL | 🟡 |
| BYROW | 🟡 |
| CHOOSECOLS | 🟠 |
| CHOOSEROWS | 🟠 |
| FLATTEN | 🟡 |
| FREQUENCY | 🟡 |
| GROWTH | 🟠 |
| HSTACK | 🟡 |
| LINEST | 🟠 |
| LOGEST | 🟠 |
| MAKEARRAY | 🟠 |
| MAP | 🟡 |
| MDETERM | 🟠 |
| MINVERSE | 🟠 |
| MMULT | 🟠 |
| REDUCE | 🟡 |
| SCAN | 🟡 |
| SUMPRODUCT | 🔵 |
| SUMX2MY2 | 🟠 |
| SUMX2PY2 | 🟠 |
| SUMXMY2 | 🟠 |
| TOCOL | 🟡 |
| TOROW | 🟡 |
| TRANSPOSE | 🔵 |
| TREND | 🟠 |
| VSTACK | 🟡 |
| WRAPCOLS | 🟡 |
| WRAPROWS | 🟡 |

### Database

| Function | Status |
| --- | --- |
| DAVERAGE | 🟠 |
| DCOUNT | 🟠 |
| DCOUNTA | 🟠 |
| DGET | 🟠 |
| DMAX | 🟠 |
| DMIN | 🟠 |
| DPRODUCT | 🟠 |
| DSTDEV | 🟠 |
| DSTDEVP | 🟠 |
| DSUM | 🟠 |
| DVAR | 🟠 |
| DVARP | 🟠 |

### Date

| Function | Status |
| --- | --- |
| DATE | ✅ |
| DATEDIF | 🔵 |
| DATEVALUE | 🔵 |
| DAY | ✅ |
| DAYS | ✅ |
| DAYS360 | 🟡 |
| EDATE | 🔵 |
| EOMONTH | 🔵 |
| EPOCHTODATE | 🟡 |
| HOUR | ✅ |
| ISOWEEKNUM | 🔵 |
| MINUTE | ✅ |
| MONTH | ✅ |
| NETWORKDAYS | 🔵 |
| NETWORKDAYS.INTL | 🟡 |
| NOW | ✅ |
| SECOND | ✅ |
| TIME | ✅ |
| TIMEVALUE | 🔵 |
| TODAY | ✅ |
| WEEKDAY | ✅ |
| WEEKNUM | 🔵 |
| WORKDAY | 🔵 |
| WORKDAY.INTL | 🟡 |
| YEAR | ✅ |
| YEARFRAC | 🔵 |

### Engineering

| Function | Status |
| --- | --- |
| BIN2DEC | 🟠 |
| BIN2HEX | 🟠 |
| BIN2OCT | 🟠 |
| BITAND | 🟠 |
| BITLSHIFT | 🟠 |
| BITOR | 🟠 |
| BITRSHIFT | 🟠 |
| BITXOR | 🟠 |
| COMPLEX | 🟠 |
| DEC2BIN | 🟠 |
| DEC2HEX | 🟠 |
| DEC2OCT | 🟠 |
| DELTA | 🟠 |
| ERF | 🟠 |
| ERF.PRECISE | 🟠 |
| GESTEP | 🟠 |
| HEX2BIN | 🟠 |
| HEX2DEC | 🟠 |
| HEX2OCT | 🟠 |
| IMABS | 🟠 |
| IMAGINARY | 🟠 |
| IMARGUMENT | 🟠 |
| IMCONJUGATE | 🟠 |
| IMCOS | 🟠 |
| IMCOSH | 🟠 |
| IMCOT | 🟠 |
| IMCOTH | 🟠 |
| IMCSC | 🟠 |
| IMCSCH | 🟠 |
| IMDIV | 🟠 |
| IMEXP | 🟠 |
| IMLOG | 🟠 |
| IMLOG10 | 🟠 |
| IMLOG2 | 🟠 |
| IMPRODUCT | 🟠 |
| IMREAL | 🟠 |
| IMSEC | 🟠 |
| IMSECH | 🟠 |
| IMSIN | 🟠 |
| IMSINH | 🟠 |
| IMSUB | 🟠 |
| IMSUM | 🟠 |
| IMTAN | 🟠 |
| IMTANH | 🟠 |
| OCT2BIN | 🟠 |
| OCT2DEC | 🟠 |
| OCT2HEX | 🟠 |

### Filter

| Function | Status |
| --- | --- |
| FILTER | 🔵 |
| SORT | 🔵 |
| SORTN | 🟡 |
| UNIQUE | 🔵 |

### Financial

| Function | Status |
| --- | --- |
| ACCRINT | 🟠 |
| ACCRINTM | 🟠 |
| AMORLINC | 🟠 |
| COUPDAYBS | 🟠 |
| COUPDAYS | 🟠 |
| COUPDAYSNC | 🟠 |
| COUPNCD | 🟠 |
| COUPNUM | 🟠 |
| COUPPCD | 🟠 |
| CUMIPMT | 🟠 |
| CUMPRINC | 🟠 |
| DB | 🟡 |
| DDB | 🟡 |
| DISC | 🟠 |
| DOLLARDE | 🟠 |
| DOLLARFR | 🟠 |
| DURATION | 🟠 |
| EFFECT | 🟡 |
| FV | 🟡 |
| FVSCHEDULE | 🟠 |
| INTRATE | 🟠 |
| IPMT | 🟡 |
| IRR | 🟡 |
| ISPMT | 🟠 |
| MDURATION | 🟠 |
| MIRR | 🟠 |
| NOMINAL | 🟠 |
| NPER | 🟡 |
| NPV | 🟡 |
| PDURATION | 🟠 |
| PMT | 🟡 |
| PPMT | 🟡 |
| PRICE | 🟠 |
| PRICEDISC | 🟠 |
| PRICEMAT | 🟠 |
| PV | 🟡 |
| RATE | 🟡 |
| RECEIVED | 🟠 |
| RRI | 🟠 |
| SLN | 🟡 |
| SYD | 🟠 |
| TBILLEQ | 🟠 |
| TBILLPRICE | 🟠 |
| TBILLYIELD | 🟠 |
| VDB | 🟠 |
| XIRR | 🟡 |
| XNPV | 🟡 |
| YIELD | 🟠 |
| YIELDDISC | 🟠 |
| YIELDMAT | 🟠 |

### Info

| Function | Status |
| --- | --- |
| CELL | ⬜ |
| ERROR.TYPE | 🔵 |
| ISBLANK | ✅ |
| ISDATE | 🔵 |
| ISEMAIL | ⬜ |
| ISERR | ✅ |
| ISERROR | ✅ |
| ISFORMULA | ⬜ |
| ISLOGICAL | ✅ |
| ISNA | ✅ |
| ISNONTEXT | ✅ |
| ISNUMBER | ✅ |
| ISREF | ⬜ |
| ISTEXT | ✅ |
| N | 🔵 |
| NA | 🔵 |
| SHEETS | ⬜ |
| TYPE | 🔵 |

### Logical

| Function | Status |
| --- | --- |
| AND | ✅ |
| FALSE | 🔵 |
| IF | ✅ |
| IFERROR | ✅ |
| IFNA | ✅ |
| IFS | ✅ |
| LAMBDA | 🟡 |
| LET | 🔵 |
| NOT | ✅ |
| OR | ✅ |
| SWITCH | ✅ |
| TRUE | 🔵 |
| XOR | 🔵 |

### Lookup

| Function | Status |
| --- | --- |
| ADDRESS | 🔵 |
| CHOOSE | 🔵 |
| COLUMN | 🔵 |
| COLUMNS | 🔵 |
| FORMULATEXT | 🟡 |
| GETPIVOTDATA | ⬜ |
| HLOOKUP | ✅ |
| INDEX | ✅ |
| INDIRECT | 🔵 |
| LOOKUP | 🔵 |
| MATCH | ✅ |
| OFFSET | 🔵 |
| ROW | 🔵 |
| ROWS | 🔵 |
| SHEET | ⬜ |
| VLOOKUP | ✅ |
| XLOOKUP | 🔵 |

### Math

| Function | Status |
| --- | --- |
| ABS | ✅ |
| ACOS | 🔵 |
| ACOSH | 🟡 |
| ACOT | 🟡 |
| ACOTH | 🟡 |
| ASIN | 🔵 |
| ASINH | 🟡 |
| ATAN | 🔵 |
| ATAN2 | 🔵 |
| ATANH | 🟡 |
| BASE | 🟡 |
| CEILING | 🔵 |
| CEILING.MATH | 🟡 |
| CEILING.PRECISE | 🟡 |
| COMBIN | 🔵 |
| COMBINA | 🟡 |
| COS | 🔵 |
| COSH | 🟡 |
| COT | 🟡 |
| COTH | 🟡 |
| COUNTBLANK | ✅ |
| COUNTIF | ✅ |
| COUNTIFS | ✅ |
| COUNTUNIQUE | 🔵 |
| CSC | 🟡 |
| CSCH | 🟡 |
| DECIMAL | 🟡 |
| DEGREES | 🔵 |
| ERFC | 🟠 |
| ERFC.PRECISE | 🟠 |
| EVEN | 🔵 |
| EXP | 🔵 |
| FACT | 🔵 |
| FACTDOUBLE | 🟡 |
| FLOOR | 🔵 |
| FLOOR.MATH | 🟡 |
| FLOOR.PRECISE | 🟡 |
| GAMMALN | 🟠 |
| GAMMALN.PRECISE | 🟠 |
| GCD | 🟡 |
| IMLN | 🟠 |
| IMPOWER | 🟠 |
| IMSQRT | 🟠 |
| INT | ✅ |
| ISEVEN | 🟡 |
| ISO.CEILING | 🟡 |
| ISODD | 🟡 |
| LCM | 🟡 |
| LN | 🔵 |
| LOG | 🔵 |
| LOG10 | 🔵 |
| MOD | ✅ |
| MROUND | 🔵 |
| MULTINOMIAL | 🟡 |
| MUNIT | 🟠 |
| ODD | 🔵 |
| PI | 🔵 |
| POWER | ✅ |
| PRODUCT | ✅ |
| QUOTIENT | 🔵 |
| RADIANS | 🔵 |
| RAND | ✅ |
| RANDARRAY | 🟡 |
| RANDBETWEEN | ✅ |
| ROUND | ✅ |
| ROUNDDOWN | ✅ |
| ROUNDUP | ✅ |
| SEC | 🟡 |
| SECH | 🟡 |
| SEQUENCE | 🟡 |
| SERIESSUM | 🟠 |
| SIGN | 🔵 |
| SIN | 🔵 |
| SINH | 🟡 |
| SQRT | ✅ |
| SQRTPI | 🟡 |
| SUBTOTAL | 🟡 |
| SUM | ✅ |
| SUMIF | ✅ |
| SUMIFS | ✅ |
| SUMSQ | 🔵 |
| TAN | 🔵 |
| TANH | 🟡 |
| TRUNC | 🔵 |

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
| UNIQUE | 🔵 |
| UPLUS | ⬜ |

### Parser

| Function | Status |
| --- | --- |
| CONVERT | 🟡 |
| TO_DATE | 🟡 |
| TO_DOLLARS | 🟡 |
| TO_PERCENT | 🟡 |
| TO_PURE_NUMBER | 🟡 |
| TO_TEXT | 🟡 |

### Statistical

| Function | Status |
| --- | --- |
| AVEDEV | 🟡 |
| AVERAGE | ✅ |
| AVERAGE.WEIGHTED | 🟡 |
| AVERAGEA | 🟡 |
| AVERAGEIF | 🔵 |
| AVERAGEIFS | 🔵 |
| BETA.DIST | 🟠 |
| BETA.INV | 🟠 |
| BETADIST | 🟠 |
| BETAINV | 🟠 |
| BINOM.DIST | 🟠 |
| BINOM.INV | 🟠 |
| BINOMDIST | 🟠 |
| CHIDIST | 🟠 |
| CHIINV | 🟠 |
| CHISQ.DIST | 🟠 |
| CHISQ.DIST.RT | 🟠 |
| CHISQ.INV | 🟠 |
| CHISQ.INV.RT | 🟠 |
| CHISQ.TEST | 🟠 |
| CHITEST | 🟠 |
| CONFIDENCE | 🟠 |
| CONFIDENCE.NORM | 🟠 |
| CONFIDENCE.T | 🟠 |
| CORREL | 🔵 |
| COUNT | ✅ |
| COUNTA | ✅ |
| COVAR | 🟠 |
| COVARIANCE.P | 🟠 |
| COVARIANCE.S | 🟠 |
| CRITBINOM | 🟠 |
| DEVSQ | 🟡 |
| EXPON.DIST | 🟠 |
| EXPONDIST | 🟠 |
| F.DIST | 🟠 |
| F.DIST.RT | 🟠 |
| F.INV | 🟠 |
| F.INV.RT | 🟠 |
| F.TEST | 🟠 |
| FDIST | 🟠 |
| FINV | 🟠 |
| FISHER | 🟠 |
| FISHERINV | 🟠 |
| FORECAST | 🔵 |
| FORECAST.LINEAR | 🔵 |
| FTEST | 🟠 |
| GAMMA | 🟠 |
| GAMMA.DIST | 🟠 |
| GAMMA.INV | 🟠 |
| GAMMADIST | 🟠 |
| GAMMAINV | 🟠 |
| GAUSS | 🟠 |
| GEOMEAN | 🟡 |
| HARMEAN | 🟡 |
| HYPGEOM.DIST | 🟠 |
| HYPGEOMDIST | 🟠 |
| INTERCEPT | 🔵 |
| KURT | 🟠 |
| LARGE | 🔵 |
| LOGINV | 🟠 |
| LOGNORM.DIST | 🟠 |
| LOGNORM.INV | 🟠 |
| LOGNORMDIST | 🟠 |
| MARGINOFERROR | 🟠 |
| MAX | ✅ |
| MAXA | 🟡 |
| MAXIFS | 🔵 |
| MEDIAN | ✅ |
| MIN | ✅ |
| MINA | 🟡 |
| MINIFS | 🔵 |
| MODE | 🔵 |
| MODE.MULT | 🟡 |
| MODE.SNGL | 🔵 |
| NEGBINOM.DIST | 🟠 |
| NEGBINOMDIST | 🟠 |
| NORM.DIST | 🟠 |
| NORM.INV | 🟠 |
| NORM.S.DIST | 🟠 |
| NORM.S.INV | 🟠 |
| NORMDIST | 🟠 |
| NORMINV | 🟠 |
| NORMSDIST | 🟠 |
| NORMSINV | 🟠 |
| PEARSON | 🟡 |
| PERCENTILE | 🔵 |
| PERCENTILE.EXC | 🟡 |
| PERCENTILE.INC | 🔵 |
| PERCENTRANK | 🟡 |
| PERCENTRANK.EXC | 🟡 |
| PERCENTRANK.INC | 🟡 |
| PERMUT | 🟡 |
| PERMUTATIONA | 🟡 |
| PHI | 🟠 |
| POISSON | 🟠 |
| POISSON.DIST | 🟠 |
| PROB | 🟠 |
| QUARTILE | 🔵 |
| QUARTILE.EXC | 🟡 |
| QUARTILE.INC | 🔵 |
| RANK | 🔵 |
| RANK.AVG | 🟡 |
| RANK.EQ | 🟡 |
| RSQ | 🟡 |
| SKEW | 🟠 |
| SKEW.P | 🟠 |
| SLOPE | 🔵 |
| SMALL | 🔵 |
| STANDARDIZE | 🟠 |
| STDEV | 🔵 |
| STDEV.P | 🔵 |
| STDEV.S | 🔵 |
| STDEVA | 🟡 |
| STDEVP | 🔵 |
| STDEVPA | 🟡 |
| STEYX | 🟡 |
| T.DIST | 🟠 |
| T.DIST.2T | 🟠 |
| T.DIST.RT | 🟠 |
| T.INV | 🟠 |
| T.INV.2T | 🟠 |
| T.TEST | 🟠 |
| TDIST | 🟠 |
| TINV | 🟠 |
| TRIMMEAN | 🟡 |
| TTEST | 🟠 |
| VAR | 🔵 |
| VAR.P | 🔵 |
| VAR.S | 🔵 |
| VARA | 🟡 |
| VARP | 🔵 |
| VARPA | 🟡 |
| WEIBULL | 🟠 |
| WEIBULL.DIST | 🟠 |
| Z.TEST | 🟠 |
| ZTEST | 🟠 |

### Text

| Function | Status |
| --- | --- |
| ARABIC | 🟡 |
| ASC | 🟡 |
| CHAR | 🔵 |
| CLEAN | 🔵 |
| CODE | 🔵 |
| CONCATENATE | ✅ |
| DOLLAR | 🔵 |
| EXACT | 🔵 |
| FIND | ✅ |
| FINDB | 🟡 |
| FIXED | 🔵 |
| JOIN | 🔵 |
| LEFT | ✅ |
| LEFTB | 🟡 |
| LEN | ✅ |
| LENB | 🟡 |
| LOWER | ✅ |
| MID | ✅ |
| MIDB | 🟡 |
| PROPER | ✅ |
| REGEXEXTRACT | 🟡 |
| REGEXMATCH | 🔵 |
| REGEXREPLACE | 🟡 |
| REPLACE | 🔵 |
| REPLACEB | 🟡 |
| REPT | 🔵 |
| RIGHT | ✅ |
| RIGHTB | 🟡 |
| ROMAN | 🟡 |
| SEARCH | ✅ |
| SEARCHB | 🟡 |
| SPLIT | 🔵 |
| SUBSTITUTE | ✅ |
| T | 🔵 |
| TEXT | 🔵 |
| TEXTJOIN | ✅ |
| TRIM | ✅ |
| UNICHAR | 🟡 |
| UNICODE | 🟡 |
| UPPER | ✅ |
| VALUE | 🔵 |

### Web

| Function | Status |
| --- | --- |
| ENCODEURL | ⬜ |
| HYPERLINK | ⬜ |
| IMPORTDATA | ⬜ |
| IMPORTFEED | ⬜ |
| IMPORTHTML | ⬜ |
| IMPORTRANGE | ⬜ |
| IMPORTXML | ⬜ |
| ISURL | ⬜ |
