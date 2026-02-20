---
title: formula-and-calculator
target-version: 0.1.0
---

# Formula Engine and Calculator

## Summary

The formula engine and calculator are responsible for parsing, evaluating, and
recalculating spreadsheet formulas in the `@wafflebase/sheet` package. The
engine uses an ANTLR-generated parser for formula syntax, a visitor-based
evaluator for computing results, and a topological-sort calculator for
propagating changes through cell dependencies. Cross-sheet formula references
allow formulas in one sheet to read values from another sheet.

### Goals

- Parse and evaluate formulas with correct operator precedence and function
  calls.
- Recalculate dependent cells in topological order after any cell change.
- Detect circular references and mark them with `#REF!` instead of looping.
- Support cross-sheet references (e.g., `=Sheet2!A1`, `=SUM(Sheet2!A1:A3)`)
  with a pluggable resolver.

### Non-Goals

- Server-side formula evaluation — all computation runs in the browser.
- Full Excel/Google Sheets function parity — functions are added incrementally.

## Proposal Details

### ANTLR Grammar

The grammar (`antlr/Formula.g4`) defines the formula syntax:

```antlr
grammar Formula;
formula: expr+ ;

expr: FUNCNAME '(' args? ')'                      # Function
    | expr op=(MUL|DIV) expr                       # MulDiv
    | expr op=(ADD|SUB) expr                       # AddSub
    | expr op=(EQ|NEQ|LT|GT|LTE|GTE) expr         # Comparison
    | NUM                                          # Number
    | BOOL                                         # Boolean
    | STRING                                       # Str
    | REFERENCE                                    # Reference
    | '(' expr ')'                                 # Parentheses
    ;

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
REF: '$'? [A-Za-z] [A-Za-z]? [A-Za-z]? '$'? [1-9][0-9]* ;
REFRANGE: REF ':' REF ;
```

**Operator precedence** (high to low): `* /` → `+ -` → `= <> < > <= >=`.

**Cell references** support up to 3 letters and arbitrary row numbers
(e.g., `ZZZ729443`). Optional `$` prefixes enable absolute references
(`$A$1`, `A$1`, `$A1`).

**Cross-sheet references** use the `SheetName!Ref` syntax. Sheet names
containing spaces or special characters are quoted: `'My Sheet'!A1`.

### Evaluation Pipeline

Source: `src/formula/formula.ts`

```
Formula string → ANTLR Lexer → Token stream → ANTLR Parser → AST → Evaluator (visitor) → EvalNode → String result
```

1. **Parse** — The formula string (minus the leading `=`) is tokenized and
   parsed by the ANTLR-generated lexer/parser into an AST.
2. **Visit** — An `Evaluator` class (implementing the ANTLR visitor pattern)
   walks the AST. Each node evaluates to an `EvalNode`:
   - `NumNode { t: 'num', v: number }`
   - `StrNode { t: 'str', v: string }`
   - `BoolNode { t: 'bool', v: boolean }`
   - `RefNode { t: 'ref', v: Reference }`
   - `ErrNode { t: 'err', v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!' }`
3. **Resolve** — If the final result is a `RefNode`, its value is looked up
   from the provided `Grid`. If the reference is a range (`Srng`), the result
   is `#VALUE!`. Otherwise the result is converted to a string.

### Helper Functions

| Function                                         | Source       | Description                                                                               |
| ------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------- |
| `extractReferences(formula)`                     | `formula.ts` | Returns all `REFERENCE` tokens (uppercased) as a `Set<Reference>`                         |
| `extractTokens(formula)`                         | `formula.ts` | Returns all tokens with type, position, and text — fills gaps with `STRING` tokens        |
| `extractFormulaRanges(formula)`                  | `formula.ts` | Returns ranges referenced in the formula (skips cross-sheet refs) for visual highlighting |
| `evaluate(formula, grid?)`                       | `formula.ts` | Full parse → visit → resolve pipeline, returns a display string                           |
| `isReferenceInsertPosition(formula, cursorPos)`  | `formula.ts` | Checks if the cursor is at a valid position to insert a cell reference                    |
| `findReferenceTokenAtCursor(formula, cursorPos)` | `formula.ts` | Returns the `REFERENCE` token at the cursor, or `undefined`                               |

### Arguments System

Source: `src/formula/arguments.ts`

The `Arguments<T>` helper class provides type coercion for function arguments:

- **`NumberArgs`** — Coerces values to numbers: booleans → 0/1, strings →
  `parseFloat`, refs → grid lookup then convert. Used by `SUM`, `AVERAGE`,
  `MIN`, `MAX`, arithmetic operators.
- **`BoolArgs`** — Coerces values to booleans. Used by `IF`, `AND`, `OR`,
  `NOT`.

Key methods:

- `map(node, grid?)` — Coerces a single `EvalNode` to the target type.
- `iterate(args, visit, grid?)` — Generator that yields coerced values for
  each argument expression. Range references are expanded to individual cells
  via `toSrefs`.

### Built-in Functions

Source: `src/formula/functions.ts`

Functions are registered in `FunctionMap`. Each function receives a
`FunctionContext` (ANTLR node), a `visit` callback, and an optional `Grid`.

| Function                 | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `SUM`                    | Sum of numeric arguments                            |
| `ABS`                    | Absolute value                                      |
| `ROUND` / `ROUNDUP` / `ROUNDDOWN` | Decimal rounding controls                  |
| `INT` / `MOD`            | Integer rounding and modular arithmetic             |
| `SQRT` / `POWER`         | Square root and exponentiation                      |
| `PRODUCT` / `MEDIAN`     | Multiplication and middle-value aggregation         |
| `RAND` / `RANDBETWEEN`   | Volatile random values                              |
| `AVERAGE`                | Arithmetic mean                                     |
| `MIN` / `MAX`            | Minimum / maximum value                             |
| `COUNT`                  | Count of numeric values                             |
| `COUNTA` / `COUNTBLANK`  | Count of non-empty / blank values                   |
| `COUNTIF` / `SUMIF`      | Single-criterion conditional count/sum              |
| `COUNTIFS` / `SUMIFS`    | Multi-criteria conditional count/sum                |
| `IF`                     | Conditional: `IF(condition, true_val, [false_val])` |
| `IFS` / `SWITCH`         | Multi-branch conditional selection                  |
| `AND` / `OR` / `NOT`     | Logical operators                                   |
| `TRIM`                   | Remove leading/trailing whitespace                  |
| `LEN`                    | String length                                       |
| `LEFT` / `RIGHT` / `MID` | Substring extraction                                |
| `CONCATENATE` / `CONCAT` | String concatenation                                |
| `FIND` / `SEARCH`        | Text search (case-sensitive/insensitive)            |
| `TEXTJOIN`               | Concatenation with delimiter and empty filtering    |
| `LOWER` / `UPPER` / `PROPER` | Text case conversion                            |
| `SUBSTITUTE`             | Replace text occurrences                            |
| `TODAY` / `NOW`          | Current date / datetime                             |
| `DATE` / `TIME` / `DAYS` | Date/time construction and date differences         |
| `YEAR` / `MONTH` / `DAY` | Date component extraction                           |
| `HOUR` / `MINUTE` / `SECOND` | Time component extraction                       |
| `WEEKDAY`                | Day-of-week indexing                                |
| `ISBLANK` / `ISNUMBER` / `ISTEXT` | Core value-type checks                     |
| `ISERROR` / `ISERR` / `ISNA` | Error-type checks                              |
| `ISLOGICAL` / `ISNONTEXT` | Additional type predicates                         |
| `IFERROR` / `IFNA`       | Error handling with broad / #N/A-specific fallback  |

New functions follow the same pattern: accept `(ctx, visit, grid?)`, return
an `EvalNode`.

Autocomplete metadata is maintained separately in `src/formula/function-catalog.ts`
(`FunctionCatalog` array) with name, description, and argument info.

### Error Types

| Error     | Meaning                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `#VALUE!` | Type mismatch (e.g., arithmetic on non-numeric, range ref as scalar)     |
| `#REF!`   | Invalid cell reference (deleted cell, circular dependency, out-of-range) |
| `#N/A!`   | Function returned no applicable result (missing args)                    |
| `#ERROR!` | Catch-all for unexpected evaluation errors                               |

### Calculator

Source: `src/model/calculator.ts`

The Calculator recalculates formulas after a cell change, propagating updates
through the dependency graph in topological order.

**Algorithm:**

1. **Build dependants map** — `Sheet.setData` calls
   `store.buildDependantsMap(srefs)` to get a map of `Sref → Set<Sref>`
   (which cells are depended upon by which formula cells). Cross-sheet refs
   are excluded from this map since they are resolved through a different
   mechanism.
2. **Topological sort** — `topologicalSort(dependantsMap, refs)` performs a
   DFS on the dependants graph:
   - Tracks `visited` and `stack` (in-progress) sets to detect cycles.
   - When a cycle is detected, all refs currently on the stack are added to
     `cycledRefs`.
   - Returns `[sortedRefs, cycledRefs]` with refs in evaluation order
     (reversed post-order).
3. **Evaluate** — For each ref in topological order:
   - If the ref is in `cycledRefs`, its value is set to `#REF!`.
   - Otherwise, `extractReferences` finds all referenced cells,
     `fetchGridByReferences` loads their current values (including
     cross-sheet data), `evaluate` computes the result, and the cell is
     updated.

```
setData(ref, value)
  │
  ├── store.set(ref, cell)
  ├── store.buildDependantsMap([ref])  ──→  { A1 → {B1, C1}, B1 → {D1} }
  └── calculate(sheet, dependantsMap, [ref])
        │
        ├── topologicalSort(...)  ──→  [A1, B1, C1, D1], cycled={}
        └── for each sref in sorted:
              ├── extractReferences(formula)
              ├── fetchGridByReferences(refs)  ──→  Grid (including cross-sheet data)
              └── evaluate(formula, grid)  ──→  new value
```

### Cross-Sheet Formula References

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

Source: `src/model/coordinates.ts`

| Function                  | Description                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `isCrossSheetRef(ref)`    | Returns `true` if the reference contains `!`                                                                |
| `parseCrossSheetRef(ref)` | Splits `"Sheet2!A1"` → `{ sheetName: "Sheet2", localRef: "A1" }`                                            |
| `toSrefs(references)`     | Generator that decomposes ranges (including cross-sheet ranges like `SHEET2!A1:B2`) into individual `Sref`s |

#### GridResolver

The `GridResolver` callback allows the `Sheet` class to fetch data from other
sheets without knowing about the multi-sheet container:

```typescript
type GridResolver = (
  sheetName: string, // Uppercased sheet name
  refs: Set<Sref>, // Set of local cell refs needed
) => Grid | undefined; // Map of localRef → Cell, or undefined if sheet not found
```

- Set via `Sheet.setGridResolver(resolver)` or `Spreadsheet.setGridResolver(resolver)`.
- Called by `fetchGridByReferences` when it encounters cross-sheet refs.
- The resolver groups cross-sheet refs by sheet name, calls the resolver once
  per sheet, and merges results into the grid with `SHEETNAME!localRef` keys.

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

#### Recalculation

Cross-sheet dependencies are **not** included in `buildDependantsMap` — both
`MemStore` and `YorkieStore` skip refs where `isCrossSheetRef(r)` is true.
This means local `setData` recalculation does not automatically propagate
across sheets.

Instead, cross-sheet recalculation is handled explicitly:

- **`Sheet.recalculateCrossSheetFormulas()`** — Scans all formula cells and
  runs a single dependency recalculation pass using the
  existing calculator (`buildDependantsMap` + topological evaluation). This
  avoids separate cross-sheet vs local-chain code paths and ensures updates
  propagate through local dependants of cross-sheet formulas.

- **`Spreadsheet.recalculateCrossSheetFormulas()`** — Calls the Sheet method
  and then re-renders.

#### Triggers in the Frontend

Source: `packages/frontend/src/app/spreadsheet/sheet-view.tsx`

1. **GridResolver setup** — When a `SheetView` mounts, it sets a resolver that
   looks up other tabs in the Yorkie document by name (case-insensitive) and
   returns their cell data.

2. **Remote changes** — `doc.subscribe("remote-change")` triggers a coalesced
   recalculation flow. If multiple remote-change events arrive while
   recalculation is running, they are merged into one additional follow-up
   pass.

3. **Tab switch** — When the user switches tabs, the `SheetView` component
   re-mounts and calls `recalculateCrossSheetFormulas()` on initialization, so
   any changes made in other sheets are reflected immediately.

#### Shifting and Moving

Cross-sheet references are **not shifted or moved** when rows/columns are
inserted, deleted, or moved. The `shiftFormula` and `moveFormula` functions
in `src/model/shifting.ts` detect cross-sheet refs (via the `!` character)
and preserve them as-is. This matches Excel/Google Sheets behavior where
cross-sheet references are only adjusted when the referenced sheet itself
changes structure.

## Risks and Mitigation

**Formula function coverage** — 65 built-in functions are implemented. New
functions are added to `FunctionMap` and `FunctionCatalog` following the same
pattern: accept `(ctx, visit, grid?)`, return an `EvalNode`.

**Circular references** — The calculator's topological sort detects cycles and
marks affected cells with `#REF!` rather than entering an infinite loop.

**Cross-sheet stale values** — Because cross-sheet refs are excluded from the
local dependants map, values can become stale until
`recalculateCrossSheetFormulas()` is called. The frontend mitigates this by
calling it on tab switch and remote changes.

**Performance** — The simplified model recalculates all formulas on
cross-sheet refresh. This is easier to reason about and more robust for
dependency chains, but can be slower on very large sheets. Mitigations:

1. Batched writes during recalculation to reduce transaction overhead.
2. Coalesced remote-change triggers in the frontend to avoid overlapping
   recalculation runs.
