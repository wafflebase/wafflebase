# Formula Grammar Gap Fixes

## Problem
The ANTLR formula engine lacked several grammar-level constructs needed
for full spreadsheet function coverage.

## Tasks
- [x] Add unary sign support (`=-5`, `=+5`, `=--5`)
- [x] Add string concatenation operator (`="a"&"b"`)
- [x] Add empty argument handling (`=IF(TRUE,,1)`, `=SUM(1,,3)`)
- [x] Add type-aware comparison (`="abc"<"def"`, case-insensitive)
- [x] Add array literal support (`={1,2,3}`, `={1,2;3,4}`)
- [x] Add scientific notation (`=1.5E3`, `=1E-3`)
- [x] Add LET/LAMBDA support (`=LET(x,5,x*2)`, `=LAMBDA(x,x*2)(5)`)
- [x] Verify all tests pass (897 sheet + 17 backend)

## Review
- 6 commits covering 7 grammar/evaluator improvements
- All changes followed TDD: failing test → minimal impl → verify
- Grammar regenerated via Docker (eclipse-temurin:17-jre) since Java
  is not installed locally
