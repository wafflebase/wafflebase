---
title: formula
target-version: 0.2.0
---

# Formula Engine

## Summary

The formula engine parses and evaluates spreadsheet formulas in the
`@wafflebase/sheets` package. It uses an ANTLR-generated parser for formula
syntax and a visitor-based evaluator for computing results. Cross-sheet
references allow formulas in one sheet to read values from another sheet
through pluggable resolvers.

### Goals

- Parse and evaluate formulas with correct operator precedence and function
  calls.
- Support cross-sheet references (e.g., `=Sheet2!A1`, `=SUM(Sheet2!A1:A3)`)
  with a pluggable resolver.

### Non-Goals

- Server-side formula evaluation — all computation runs in the browser.
- Full Excel/Google Sheets function parity — functions are added incrementally.
  See [formula-coverage.md](formula-coverage.md) for the prioritized plan.

## Proposal Details

### ANTLR Grammar

The grammar (`packages/sheets/antlr/Formula.g4`) defines the formula syntax:

```antlr
grammar Formula;
formula: expr+ ;

expr: FUNCNAME '(' args? ')'                      # Function
    | op=(ADD|SUB) expr                            # UnarySign
    | expr '(' args? ')'                           # Call
    | <assoc=right> expr CARET expr                # Pow
    | expr op=(MUL|DIV) expr                       # MulDiv
    | expr op=(ADD|SUB) expr                       # AddSub
    | expr AMP expr                                # Concat
    | expr op=(EQ|NEQ|LT|GT|LTE|GTE) expr         # Comparison
    | NUM                                          # Number
    | BOOL                                         # Boolean
    | STRING                                       # Str
    | REFERENCE                                    # Reference
    | FUNCNAME                                     # Identifier
    | '(' expr ')'                                 # Parentheses
    | '{' arrayRow (SEMI arrayRow)* '}'            # ArrayLiteral
    ;

arrayRow: expr (',' expr)* ;
args: expr (',' expr)* ;

REFERENCE: QUOTED_SHEET_NAME '!' REFRANGE
         | QUOTED_SHEET_NAME '!' REF
         | SHEET_NAME '!' REFRANGE
         | SHEET_NAME '!' REF
         | REFRANGE
         | REF
         ;
fragment SHEET_NAME: [A-Za-z][A-Za-z0-9]* ;
fragment QUOTED_SHEET_NAME: '\'' (~['])+ '\'' ;
fragment COL: '$'? [A-Za-z] [A-Za-z]? [A-Za-z]? ;
fragment ROW: '$'? [1-9][0-9]* ;
REF: COL ROW ;
REFRANGE: REF ':' REF        // A1:B2
        | COL ':' COL         // A:A, A:C   (whole column)
        | ROW ':' ROW         // 1:1, 2:5   (whole row)
        | REF ':' COL | COL ':' REF   // A1:B, A:B1 (open-ended column)
        | REF ':' ROW | ROW ':' REF   // A1:2, 1:B2 (open-ended row)
        ;
NUM: [0-9]+('.' [0-9]+)? ([eE] [+-]? [0-9]+)? ;
```

**Operator precedence** (high to low): function call → unary `+ -` →
expression call → `^` (right-associative) → `* /` → `+ -` → `&` →
`= <> < > <= >=`.

**Cell references** support up to 3 letters and arbitrary row numbers
(e.g., `ZZZ729443`). Optional `$` prefixes enable absolute references
(`$A$1`, `A$1`, `$A1`).

**Cross-sheet references** use the `SheetName!Ref` syntax. Sheet names
containing spaces or special characters are quoted: `'My Sheet'!A1`.

#### Whole-column / whole-row / open-ended ranges

`REFRANGE` also accepts ranges whose endpoints omit a row and/or column,
matching Excel / Google Sheets:

| Syntax   | Meaning                                        |
| -------- | ---------------------------------------------- |
| `A:A`    | Entire column A                                |
| `A:C`    | Columns A through C                            |
| `1:1`    | Entire row 1                                   |
| `2:5`    | Rows 2 through 5                               |
| `A1:B`   | From A1 to the bottom of column B (open-ended) |
| `B2:B`   | From B2 to the bottom of column B              |

Because the data model stores every range as a concrete `[from, to]` pair
of cells, an unbounded range must be clamped to the sheet's data extent
before evaluation. This happens **up front**, so the evaluator and every
`toSrefs` call site keep working on ordinary bounded ranges:

1. `Store.getUsedBounds()` returns the bounding `Range` of all populated
   cells (delegates to `CellIndex.bounds()`), or `undefined` for an empty
   sheet.
2. `expandUnboundedRanges(formula, bounds)` (in `formula.ts`) tokenizes the
   formula and rewrites each local unbounded `REFERENCE` token to a concrete
   `toSrng(resolveRange(ref, bounds))`. Omitted parts of the `from` endpoint
   default to the top-left (row 1 / column 1); omitted parts of `to` default
   to the bottom-right of `bounds`. Formulas with no unbounded reference are
   returned unchanged.
3. The **calculator** rewrites `cell.f` before `extractReferences` /
   `evaluateWithSpill`; `buildDependantsMap` (MemStore + YorkieStore) applies
   the same rewrite so editing any cell in a referenced column/row still
   triggers recalculation (the dependants map is rebuilt on every edit, so
   cells added beyond the prior extent are picked up on their own write).

Blank cells inside a range contribute nothing to aggregations
(`Arguments.iterate` skips them), so `AVERAGE`/`MIN`/`MAX`/`COUNT` over a
whole column ignore the empty cells rather than treating them as `0`.

**Limitations.** Cross-sheet unbounded refs (`Sheet2!A:A`) are not resolved —
the calculator only knows the local sheet's bounds — and evaluate to
`#ERROR!`. Whole-column/row highlighting (`extractFormulaRanges`) skips
unbounded refs.

### Evaluation Pipeline

Source: `packages/sheets/src/formula/formula.ts`

```
Formula string → ANTLR Lexer → Token stream → ANTLR Parser → AST → Evaluator (visitor) → EvalNode → String result
```

1. **Parse** — The formula string (minus the leading `=`) is tokenized and
   parsed by the ANTLR-generated lexer/parser into an AST.
   On evaluation, any parser syntax error is treated as `#ERROR!` (no
   recovery-based partial evaluation).
2. **Preprocess** — Empty argument positions (`=IF(TRUE,,1)`) are filled
   with a sentinel function call (`zEmptyArg__()`) before parsing.
3. **Visit** — An `Evaluator` class (implementing the ANTLR visitor pattern)
   walks the AST. Each node evaluates to an `EvalNode`:
   - `NumNode { t: 'num', v: number }`
   - `StrNode { t: 'str', v: string }`
   - `BoolNode { t: 'bool', v: boolean }`
   - `RefNode { t: 'ref', v: Reference }`
   - `ErrNode { t: 'err', v: '#NULL!' | '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#NUM!' | '#N/A' | '#ERROR!' }`
   - `EmptyNode { t: 'empty' }` — sentinel for omitted arguments
   - `ArrNode { t: 'arr', v: EvalNode[][], rows, cols }` — array literal
   - `LambdaNode { t: 'lambda', params, body, closureScope }` — lambda
4. **Resolve** — If the final result is a `RefNode`, its value is looked up
   from the provided `Grid`. If the reference is a range (`Srng`), the result
   is `#VALUE!`. `ArrNode` returns the top-left value. `LambdaNode` returns
   `#ERROR!` (not invoked). Otherwise the result is converted to a string.

### Helper Functions

| Function                                         | Source       | Description                                                                               |
| ------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------- |
| `extractReferences(formula)`                     | (see above) | Returns all `REFERENCE` tokens (uppercased) as a `Set<Reference>`                         |
| `expandUnboundedRanges(formula, bounds)`         | (see above) | Rewrites whole-column/row/open-ended refs (`A:A`, `1:1`, `A1:B`) to concrete ranges clamped to `bounds` |
| `extractTokens(formula)`                         | (see above) | Returns all tokens with type, position, and text — fills gaps with `STRING` tokens        |
| `extractFormulaRanges(formula)`                   | (see above) | Returns ranges referenced in the formula (skips cross-sheet refs) for visual highlighting |
| `evaluate(formula, grid?)`                       | (see above) | Full parse → visit → resolve pipeline, returns a display string                           |
| `isReferenceInsertPosition(formula, cursorPos)`  | (see above) | Checks if the cursor is at a valid position to insert a cell reference                    |
| `findReferenceTokenAtCursor(formula, cursorPos)` | (see above) | Returns the `REFERENCE` token at the cursor, or `undefined`                               |

### Arguments System

Source: `packages/sheets/src/formula/arguments.ts`

The `Arguments<T>` helper class provides type coercion for function arguments:

- **`NumberArgs`** — Coerces values to numbers: booleans → 0/1, strings →
  `parseFloat`, refs → grid lookup then convert. Used by `SUM`, `AVERAGE`,
  `MIN`, `MAX`, arithmetic operators.
- **`BoolArgs`** — Coerces values to booleans. Used by `IF`, `AND`, `OR`,
  `NOT`.
- **`StringArgs`** — Coerces values to strings: numbers → `.toString()`,
  booleans → `TRUE`/`FALSE`, refs → grid lookup. Used by `&` concatenation
  and text functions.

Key methods:

- `map(node, grid?)` — Coerces a single `EvalNode` to the target type.
  `EmptyNode` is coerced to the type's zero value (0, `""`, false).
  `ArrNode` is coerced via its top-left value.
- `iterate(args, visit, grid?)` — Generator that yields coerced values for
  each argument expression. Range references are expanded to individual cells
  via `toSrefs`. Array literals are flattened element-by-element.

### Built-in Functions

Source: `packages/sheets/src/formula/functions.ts`

Functions are registered in `FunctionMap`. Each function receives a
`FunctionContext` (ANTLR node), a `visit` callback, and an optional
`Grid`. LET and LAMBDA are handled as special forms in the Evaluator
(not in `FunctionMap`) because they require direct scope access.

> **Catalog counts and per-function status** live in
> [formula-coverage.md](formula-coverage.md). That doc tracks the
> total entry count, unique-function count, alias count, the
> category table, and Google-Sheets parity status. The summary
> below is a category sketch only — `formula-coverage.md` is
> authoritative.

| Category    | Examples                                              |
| ----------- | ----------------------------------------------------- |
| Math        | SUM, ABS, ROUND, CEILING, FLOOR, SIN, COS, LOG, GCD  |
| Statistical | AVERAGE, STDEV, NORM.DIST, T.DIST, CHISQ.TEST, CORREL|
| Engineering | COMPLEX, IMSUM, BESSELJ, HEX2DEC, BITAND, ERF, DELTA |
| Financial   | PMT, NPV, IRR, PRICE, YIELD, ACCRINT, DURATION, XIRR |
| Text        |    38 | TRIM, LEFT, MID, SUBSTITUTE, TEXTJOIN, REGEXMATCH     |
| Lookup      |    32 | VLOOKUP, XLOOKUP, INDEX, MATCH, SORT, FILTER, XMATCH  |
| Date        |    25 | TODAY, DATE, EDATE, NETWORKDAYS, YEARFRAC, DAYS360     |
| Info        |    21 | ISBLANK, ISNUMBER, TYPE, CELL, ISFORMULA, ERROR.TYPE   |
| Database    |    12 | DSUM, DAVERAGE, DCOUNT, DGET, DMAX, DMIN, DVAR         |
| Logical     |    12 | IF, IFS, SWITCH, AND, OR, NOT, XOR, IFERROR, LET, LAMBDA|

New functions follow the same pattern: accept `(ctx, visit, grid?)`, return
an `EvalNode`.

Autocomplete metadata is maintained separately in `packages/sheets/src/formula/function-catalog.ts`
(`FunctionCatalog` array) with name, Google Sheets category, description, and
argument info.

### Error Types

| Error     | Meaning                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `#NULL!`  | Reserved for the Excel space-intersection operator; never emitted by Wafflebase (see note below) |
| `#DIV/0!` | Division by zero                                                         |
| `#VALUE!` | Type mismatch (e.g., arithmetic on non-numeric, range ref as scalar)     |
| `#REF!`   | Invalid cell reference (deleted cell, circular dependency, out-of-range) |
| `#NAME?`  | Unrecognized function name or named range                                |
| `#NUM!`   | Invalid numeric value (e.g., SQRT of negative, out-of-range result)      |
| `#N/A`    | Value not available (lookup not found, missing required argument)        |
| `#ERROR!` | Catch-all for unexpected evaluation errors (Google Sheets–specific)      |

`#NULL!` is kept in the error enum only to preserve the canonical 1–8
`ERROR.TYPE` code ordering shared with Excel/Google Sheets. In Excel it
indicates an empty range intersection produced by the space operator
(`A1:A10 B1:B10`), but that operator exists neither in Google Sheets nor in
Wafflebase, so no built-in function or operator returns `#NULL!`. It can
still appear if a user types the literal `#NULL!` into a cell and another
formula reads it.

On commit (`Sheet.setData`), formula input is normalized for one safe case:
if syntax errors are only `missing ')' at '<EOF>'`, the engine appends the
required trailing `)` and stores the corrected formula.

### Cross-Sheet References

Cross-sheet references allow a formula in one sheet to read values from another
sheet. For example, `=SUM(Sheet2!A1:A3)` in Sheet1 reads cells A1–A3 from
Sheet2.

#### Reference Syntax

| Syntax          | Description                              |
| --------------- | ---------------------------------------- |
| `Sheet2!A1`     | Single cell from Sheet2                  |
| `Sheet2!A1:B3`  | Range from Sheet2                        |
| `'My Sheet'!A1` | Quoted sheet name (spaces/special chars) |
| `=A1+Sheet2!B1` | Mix of local and cross-sheet refs        |

References are parsed by the ANTLR grammar's `REFERENCE` rule, which supports
optional `SheetName!` or `'Quoted Name'!` prefixes.

#### Coordinate Helpers

Source: `packages/sheets/src/model/core/coordinates.ts`

| Function                  | Description                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `isCrossSheetRef(ref)`    | Returns `true` if the reference contains `!`                                                                |
| `parseCrossSheetRef(ref)` | Splits `"Sheet2!A1"` → `{ sheetName: "Sheet2", localRef: "A1" }`                                            |
| `toSrefs(references)`     | Generator that decomposes ranges (including cross-sheet ranges like `SHEET2!A1:B2`) into individual `Sref`s |

#### GridResolver

The `GridResolver` callback allows the `Sheet` class to fetch cell data from
other sheets without knowing about the multi-sheet container:

```typescript
type GridResolver = (
  sheetName: string, // Uppercased sheet name
  refs: Set<Sref>,   // Set of local cell refs needed
) => Grid | undefined; // Map of localRef → Cell, or undefined if sheet not found
```

- Set via `Sheet.setGridResolver(resolver)`.
- Called by `fetchGridByReferences` when it encounters cross-sheet refs.
- Groups cross-sheet refs by sheet name, calls the resolver once per sheet,
  and merges results into the grid with `SHEETNAME!localRef` keys.

#### FormulaResolver

The `FormulaResolver` callback returns formula strings from other sheets,
enabling cross-sheet cycle detection (see [calculator.md](calculator.md)):

```typescript
type FormulaResolver = (
  sheetName: string, // Uppercased sheet name
) => Map<Sref, string> | undefined; // Map of localRef → formula string
```

- Set via `Sheet.setFormulaResolver(resolver, sheetName)`.
- The `sheetName` parameter identifies the current sheet so that references
  back to itself (e.g., `SHEET1!A1` from Sheet1) are normalized to local
  form (`A1`) in the dependency graph.

#### Data Flow

```
Sheet1: =SUM(Sheet2!A1:A3)

  evaluate(formula, grid)
      │
      ├── extractReferences("=SUM(Sheet2!A1:A3)")  →  {"SHEET2!A1:A3"}
      │
      ├── fetchGridByReferences({"SHEET2!A1:A3"})
      │     │
      │     ├── toSrefs(...)  →  SHEET2!A1, SHEET2!A2, SHEET2!A3
      │     ├── isCrossSheetRef  →  group by "SHEET2"
      │     └── gridResolver("SHEET2", {A1, A2, A3})
      │           │
      │           └── looks up Sheet2's data store  →  Grid{A1: 10, A2: 20, A3: 30}
      │
      └── evaluate with grid {SHEET2!A1: 10, SHEET2!A2: 20, SHEET2!A3: 30}  →  "60"
```

#### Shifting and Moving

Cross-sheet references are **not shifted or moved** when rows/columns are
inserted, deleted, or moved. The `shiftFormula` and `moveFormula` functions
in `packages/sheets/src/model/worksheet/shifting.ts` detect cross-sheet refs
(via the `!` character) and preserve them as-is. This matches Excel/Google
Sheets behavior where cross-sheet references are only adjusted when the
referenced sheet itself changes structure.

## Risks and Mitigation

**Formula function coverage** — see
[formula-coverage.md](formula-coverage.md) for the authoritative
catalog (entry counts, category breakdown, per-function status).
LET/LAMBDA are implemented as special forms in the Evaluator with
variable scoping and closures. Remaining gaps are mainly legacy
aliases, byte-variant text functions, and higher-order array
functions (MAP, REDUCE, SCAN, BYROW, BYCOL, MAKEARRAY) that need
function implementations using the existing LAMBDA infrastructure.
New functions are added to `FunctionMap` and `FunctionCatalog`
following the same pattern: accept `(ctx, visit, grid?)`, return an
`EvalNode`.
