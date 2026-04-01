import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode } from './formula';
import { Grid } from '../model/core/types';
import {
  isSrng,
  parseRange,
  toSref,
} from '../model/core/coordinates';
import {
  toStr,
} from './functions-helpers';

/**
 * DSUM(database, field, criteria)
 */
export function dsumFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  return { t: 'num', v: result.values.reduce((a, b) => a + b, 0) };
}

/**
 * DCOUNT(database, field, criteria)
 */
export function dcountFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  return { t: 'num', v: result.values.length };
}

/**
 * DCOUNTA(database, field, criteria)
 */
export function dcountaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  return { t: 'num', v: result.strValues.filter(s => s !== '').length };
}

/**
 * DAVERAGE(database, field, criteria)
 */
export function daverageFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  if (result.values.length === 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: result.values.reduce((a, b) => a + b, 0) / result.values.length };
}

/**
 * DMAX(database, field, criteria)
 */
export function dmaxFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  if (result.values.length === 0) return { t: 'num', v: 0 };
  return { t: 'num', v: Math.max(...result.values) };
}

/**
 * DMIN(database, field, criteria)
 */
export function dminFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  if (result.values.length === 0) return { t: 'num', v: 0 };
  return { t: 'num', v: Math.min(...result.values) };
}

/**
 * DPRODUCT(database, field, criteria)
 */
export function dproductFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  if (result.values.length === 0) return { t: 'num', v: 0 };
  return { t: 'num', v: result.values.reduce((a, b) => a * b, 1) };
}

/**
 * DGET(database, field, criteria) — returns exact match, error if != 1 result.
 */
export function dgetFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  if (result.strValues.length !== 1) return { t: 'err', v: '#VALUE!' };
  const n = Number(result.strValues[0]);
  if (!isNaN(n) && result.strValues[0] !== '') return { t: 'num', v: n };
  return { t: 'str', v: result.strValues[0] };
}

/**
 * DSTDEV(database, field, criteria) — sample standard deviation.
 */
export function dstdevFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  const vals = result.values;
  if (vals.length < 2) return { t: 'err', v: '#VALUE!' };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1);
  return { t: 'num', v: Math.sqrt(variance) };
}

/**
 * DSTDEVP(database, field, criteria) — population standard deviation.
 */
export function dstdevpFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  const vals = result.values;
  if (vals.length === 0) return { t: 'err', v: '#VALUE!' };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { t: 'num', v: Math.sqrt(variance) };
}

/**
 * DVAR(database, field, criteria) — sample variance.
 */
export function dvarFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  const vals = result.values;
  if (vals.length < 2) return { t: 'err', v: '#VALUE!' };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { t: 'num', v: vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1) };
}

/**
 * DVARP(database, field, criteria) — population variance.
 */
export function dvarpFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = extractDatabaseValues(ctx, visit, grid);
  if ('t' in result) return result;
  const vals = result.values;
  if (vals.length === 0) return { t: 'err', v: '#VALUE!' };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { t: 'num', v: vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length };
}

/**
 * Helper: extract matching values from a database range using criteria.
 * database is a range reference (first row = headers, rest = data).
 * field is a column header name or 1-based index.
 * criteria is a range reference (first row = header names, rest = criteria values).
 */
function extractDatabaseValues(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { values: number[]; strValues: string[] } | EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A' };

  // Parse database range
  const dbNode = visit(exprs[0]);
  if (dbNode.t !== 'ref' || !grid) return { t: 'err', v: '#VALUE!' };
  if (!isSrng(dbNode.v)) return { t: 'err', v: '#VALUE!' };
  const dbRange = parseRange(dbNode.v);

  // Parse field (column header name or 1-based index)
  const fieldNode = visit(exprs[1]);
  let fieldCol: number;
  if (fieldNode.t === 'num') {
    fieldCol = dbRange[0].c + fieldNode.v - 1;
  } else {
    const fieldStr = toStr(fieldNode, grid);
    if (fieldStr.t === 'err') return fieldStr;
    const headerName = fieldStr.v.toLowerCase();
    fieldCol = -1;
    for (let c = dbRange[0].c; c <= dbRange[1].c; c++) {
      const headerRef = toSref({ r: dbRange[0].r, c });
      const headerCell = grid.get(headerRef);
      if (headerCell && headerCell.v && headerCell.v.toLowerCase() === headerName) {
        fieldCol = c;
        break;
      }
    }
    if (fieldCol === -1) return { t: 'err', v: '#VALUE!' };
  }

  // Parse criteria range
  const critNode = visit(exprs[2]);
  if (critNode.t !== 'ref') return { t: 'err', v: '#VALUE!' };
  if (!isSrng(critNode.v)) return { t: 'err', v: '#VALUE!' };
  const critRange = parseRange(critNode.v);

  // Read criteria headers and values
  const critHeaders: string[] = [];
  for (let c = critRange[0].c; c <= critRange[1].c; c++) {
    const hRef = toSref({ r: critRange[0].r, c });
    const hCell = grid.get(hRef);
    critHeaders.push(hCell?.v?.toLowerCase() ?? '');
  }

  // Map criteria headers to database columns
  const critCols: number[] = [];
  for (const header of critHeaders) {
    let col = -1;
    for (let c = dbRange[0].c; c <= dbRange[1].c; c++) {
      const dbHeaderRef = toSref({ r: dbRange[0].r, c });
      const dbHeaderCell = grid.get(dbHeaderRef);
      if (dbHeaderCell && dbHeaderCell.v && dbHeaderCell.v.toLowerCase() === header) {
        col = c;
        break;
      }
    }
    critCols.push(col);
  }

  // Collect criteria rows (OR between rows, AND within a row)
  const critRows: Array<Array<{ col: number; value: string }>> = [];
  for (let r = critRange[0].r + 1; r <= critRange[1].r; r++) {
    const row: Array<{ col: number; value: string }> = [];
    for (let ci = 0; ci < critHeaders.length; ci++) {
      if (critCols[ci] === -1) continue;
      const cRef = toSref({ r, c: critRange[0].c + ci });
      const cCell = grid.get(cRef);
      if (cCell && cCell.v != null && cCell.v !== '') {
        row.push({ col: critCols[ci], value: cCell.v });
      }
    }
    if (row.length > 0) critRows.push(row);
  }

  // Filter database rows
  const values: number[] = [];
  const strValues: string[] = [];
  for (let r = dbRange[0].r + 1; r <= dbRange[1].r; r++) {
    const matches = critRows.length === 0 || critRows.some(critRow =>
      critRow.every(crit => {
        const cellRef = toSref({ r, c: crit.col });
        const cell = grid.get(cellRef);
        const cellVal = cell?.v ?? '';
        // Support comparison operators
        if (crit.value.startsWith('>=')) return Number(cellVal) >= Number(crit.value.slice(2));
        if (crit.value.startsWith('<=')) return Number(cellVal) <= Number(crit.value.slice(2));
        if (crit.value.startsWith('<>')) return cellVal !== crit.value.slice(2);
        if (crit.value.startsWith('>')) return Number(cellVal) > Number(crit.value.slice(1));
        if (crit.value.startsWith('<')) return Number(cellVal) < Number(crit.value.slice(1));
        if (crit.value.startsWith('=')) return cellVal === crit.value.slice(1);
        return cellVal.toLowerCase() === crit.value.toLowerCase();
      }),
    );
    if (matches) {
      const valRef = toSref({ r, c: fieldCol });
      const valCell = grid.get(valRef);
      const raw = valCell?.v ?? '';
      strValues.push(raw);
      const n = Number(raw);
      if (!isNaN(n) && raw !== '') values.push(n);
    }
  }

  return { values, strValues };
}

export const databaseEntries: [string, (...args: any[]) => EvalNode][] = [
  ['DSUM', dsumFunc],
  ['DCOUNT', dcountFunc],
  ['DCOUNTA', dcountaFunc],
  ['DAVERAGE', daverageFunc],
  ['DMAX', dmaxFunc],
  ['DMIN', dminFunc],
  ['DPRODUCT', dproductFunc],
  ['DGET', dgetFunc],
  ['DSTDEV', dstdevFunc],
  ['DSTDEVP', dstdevpFunc],
  ['DVAR', dvarFunc],
  ['DVARP', dvarpFunc],
];
