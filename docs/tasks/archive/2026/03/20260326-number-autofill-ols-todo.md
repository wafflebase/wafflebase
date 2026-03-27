# Number Autofill — OLS Linear Trend

**Created**: 2026-03-26
**Branch**: feat-number-autofill

## Goal

Replace the current pattern-tiling autofill for numeric cells with Google Sheets-style
OLS (Ordinary Least Squares) linear trend extrapolation.

## Behavior

- **1 numeric cell**: copy value (unchanged from current)
- **2+ numeric cells along fill axis**: compute y = mx + b via OLS, extrapolate
- **Mixed content (formulas, text, empty)**: fall back to existing tiling behavior
- Vertical fill: x = row index, per-column regression
- Horizontal fill: x = col index, per-row regression

## Precision

OLS result is formatted with `toPrecision(15)` (IEEE 754 double, matching Excel/Google
Sheets). To avoid intermediate float error (e.g. `m * t + b` where `b = -7/3`),
`computeLinearTrend` computes the result as a **single fraction**:

```text
y(t) = (n * A * t + sumY * D - A * sumX) / (n * D)
```

where `A = n*sumXY - sumX*sumY` and `D = n*sumX2 - sumX²`. Integer multiplications
are exact, and one final division produces the best IEEE 754 approximation
(e.g. `174/18` → `9.66666666666667`, not `9.66666666666666`).

## Tasks

- [x] Add `computeLinearTrend()` helper in clipboard.ts
- [x] Modify `autofill()` in sheet.ts to detect numeric columns/rows and apply OLS
- [x] Add unit tests for linear trend autofill
- [x] Fix precision: single-fraction computation + `toPrecision(15)` to match Excel
- [x] Run `pnpm verify:fast` and confirm pass
- [x] Investigate and fix remaining precision drift
