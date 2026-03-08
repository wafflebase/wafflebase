# Pivot Table Manual Test Scenarios

## Prerequisites

1. `docker compose up -d` (Yorkie + PostgreSQL)
2. `pnpm dev` (frontend + backend)
3. Open a spreadsheet document in the browser

---

## Sample Data

Enter the following data starting from cell A1:

| Region | Product | Quarter | Revenue | Units |
|--------|---------|---------|---------|-------|
| East   | Widget  | Q1      | 1000    | 10    |
| East   | Widget  | Q2      | 1200    | 12    |
| East   | Gadget  | Q1      | 800     | 5     |
| East   | Gadget  | Q2      | 900     | 6     |
| West   | Widget  | Q1      | 1500    | 15    |
| West   | Widget  | Q2      | 1800    | 18    |
| West   | Gadget  | Q1      | 600     | 4     |
| West   | Gadget  | Q2      | 700     | 5     |

---

## Test 1: Basic Pivot Creation

- [ ] Select range A1:E9
- [ ] Right-click → "Insert pivot table"
- [ ] **Verify**: New "Pivot Table 1" tab is created and activated
- [ ] **Verify**: Pivot Table Editor sidebar opens on the right
- [ ] **Verify**: Source shows tab name and range (e.g., `Source: Sheet 1 (A1:E9)`)
- [ ] **Verify**: All 5 headers (Region, Product, Quarter, Revenue, Units) appear in "Add" dropdowns

## Test 2: Single Row Field + SUM

- [ ] Click "Add" under Rows → select "Region"
- [ ] Click "Add" under Values → select "Revenue" (defaults to SUM)
- [ ] Click "Refresh pivot table"
- [ ] **Verify**: Pivot table shows:
  - East: 3900
  - West: 4600
  - Grand Total: 8500

## Test 3: Cross-tab (Row + Column)

- [ ] Click "Add" under Columns → select "Quarter"
- [ ] Click "Refresh pivot table"
- [ ] **Verify**: Q1/Q2 column headers appear
- [ ] **Verify**: East Q1=1800, East Q2=2100
- [ ] **Verify**: West Q1=2100, West Q2=2500

## Test 4: Filter

- [ ] Click "Add" under Filters → select "Product"
- [ ] (Filter is applied but no values hidden yet by default)
- [ ] **Verify**: Results unchanged from Test 3

## Test 5: Sort

- [ ] Click the sort icon on "Region" row field to toggle descending
- [ ] Click "Refresh pivot table"
- [ ] **Verify**: West appears before East in the rows

## Test 6: Multiple Value Fields

- [ ] Click "Add" under Values → select "Units" (defaults to SUM)
- [ ] Click "Refresh pivot table"
- [ ] **Verify**: Each column expands to show both Revenue and Units aggregations

## Test 7: Change Aggregation

- [ ] Change "Revenue" aggregation from SUM to AVERAGE
- [ ] Click "Refresh pivot table"
- [ ] **Verify**: Revenue values change to averages (East=975, West=1150)

## Test 8: Toggle Totals

- [ ] Uncheck "Show row totals"
- [ ] Click "Refresh pivot table"
- [ ] **Verify**: Grand Total row disappears
- [ ] Re-check "Show row totals"

## Test 9: Pivot Sheet Protection

- [ ] Try clicking a cell on the pivot sheet and typing
- [ ] **Verify**: Cell editing is blocked (no data entry allowed)
- [ ] Try right-click → insert row/column
- [ ] **Verify**: Insert/delete operations are blocked

## Test 10: Remove Fields

- [ ] Remove "Units" from Values (click X)
- [ ] Remove "Quarter" from Columns (click X)
- [ ] Click "Refresh pivot table"
- [ ] **Verify**: Returns to simple row-only layout (Region → AVERAGE of Revenue)

## Test 11: Tab Switching

- [ ] Switch to the source data tab (Sheet 1)
- [ ] **Verify**: Normal sheet editing works
- [ ] Switch back to "Pivot Table 1" tab
- [ ] **Verify**: Pivot editor reopens with saved configuration
- [ ] **Verify**: Source headers still load correctly

## Test 12: Minimum Selection Validation

- [ ] On source sheet, select only 1 row (e.g., A1:E1)
- [ ] Right-click → "Insert pivot table"
- [ ] **Verify**: Error toast "Select at least 2 rows and 1 column."

---

## Status

- Created: 2026-03-07
- Last tested: pending
