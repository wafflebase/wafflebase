# Formula Grammar Gaps — Lessons

## ANTLR grammar changes require Docker for regeneration
- Local machine has no Java runtime; use Docker with
  `eclipse-temurin:17-jre` to run the ANTLR JAR
- Mount the JAR separately (`-v "$JAR_PATH":/antlr4.jar`) since
  the node_modules path is too deep for in-container resolution
- Always run `bash scripts/fix-antlr-ts.sh` after regeneration to
  add `@ts-nocheck` headers

## Choose the right abstraction level for each fix
- **Grammar-level** (unary sign, concat, array literal, scientific
  notation, call/identifier): change `.g4`, regenerate, add visitor
- **Preprocessor** (empty arguments): string rewriting before parse
  avoids grammar complexity; use sentinel function calls
- **Evaluator-only** (type-aware comparison): no grammar change needed,
  just smarter visitor logic

## Left-recursive suffix rules enable chained calls
- `expr '(' args? ')' # Call` as a left-recursive alternative lets
  `LAMBDA(x,x*2)(5)` parse as Function + Call suffix without
  touching existing function call handling
- Primary alternatives (Function) take priority over suffix (Call),
  so existing `SUM(1,2)` behavior is preserved

## Scope management for LET/LAMBDA
- Save/restore `this.scope` around bindings to prevent leaking
- LAMBDA captures closure scope at creation time via `new Map(this.scope)`
- LET/LAMBDA handled as special cases in `visitFunction` (not in
  FunctionMap) since they need direct scope access

## Empty-arg preprocessing must not break zero-arg functions
- `RAND()` and `PI()` have no arguments; `()` is not an empty arg
- Only insert sentinel after `(` when followed by `,` (not `)`)
