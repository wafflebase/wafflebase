import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode, ErrNode } from './formula';
import { NumberArgs, BoolArgs } from './arguments';
import { Grid } from '../model/core/types';
import {
  isCrossSheetRef,
  isSrng,
  parseCrossSheetRef,
  parseRange,
  parseRef,
  toColumnLabel,
  toSrefs,
} from '../model/core/coordinates';
import {
  toStr,
  isFormulaError,
  getRefsFromExpression,
  getReferenceMatrixFromExpression,
  lookupValueFromNode,
  lookupValueFromRef,
  equalLookupValues,
  compareLookupValues,
} from './functions-helpers';
import { collectNumericValues } from './functions-statistical';

/**
 * `matchFunc` is the implementation of the MATCH function.
 * MATCH(search_key, range, [search_type]) — returns relative position in a 1D range.
 */
export function matchFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return ErrNode.NA;
  }

  const lookup = lookupValueFromNode(visit(exprs[0]), grid);
  if (isFormulaError(lookup)) {
    return lookup;
  }

  const matrix = getReferenceMatrixFromExpression(exprs[1], visit, grid);
  if (matrix.t === 'err') {
    return matrix;
  }
  if (matrix.v.rowCount > 1 && matrix.v.colCount > 1) {
    return ErrNode.NA;
  }

  let searchType = 1;
  if (exprs.length === 3) {
    const searchTypeNode = NumberArgs.map(visit(exprs[2]), grid);
    if (searchTypeNode.t === 'err') {
      return searchTypeNode;
    }
    searchType = Math.trunc(searchTypeNode.v);
  }

  if (searchType !== -1 && searchType !== 0 && searchType !== 1) {
    return ErrNode.NA;
  }

  if (searchType === 0) {
    for (let i = 0; i < matrix.v.refs.length; i++) {
      const candidate = lookupValueFromRef(matrix.v.refs[i], grid);
      if (equalLookupValues(candidate, lookup)) {
        return { t: 'num', v: i + 1 };
      }
    }

    return ErrNode.NA;
  }

  let bestIndex = -1;
  if (searchType === 1) {
    let bestCmp = -Infinity;
    for (let i = 0; i < matrix.v.refs.length; i++) {
      const candidate = lookupValueFromRef(matrix.v.refs[i], grid);
      const cmp = compareLookupValues(candidate, lookup);
      if (cmp <= 0 && cmp > bestCmp) {
        bestCmp = cmp;
        bestIndex = i;
      }
    }
  } else {
    let bestCmp = Infinity;
    for (let i = 0; i < matrix.v.refs.length; i++) {
      const candidate = lookupValueFromRef(matrix.v.refs[i], grid);
      const cmp = compareLookupValues(candidate, lookup);
      if (cmp >= 0 && cmp < bestCmp) {
        bestCmp = cmp;
        bestIndex = i;
      }
    }
  }

  if (bestIndex < 0) {
    return ErrNode.NA;
  }

  return { t: 'num', v: bestIndex + 1 };
}

/**
 * `indexFunc` is the implementation of the INDEX function.
 * INDEX(reference, [row], [column]) — returns a cell value from a range.
 */
export function indexFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) {
    return ErrNode.NA;
  }

  const matrix = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if (matrix.t === 'err') {
    return matrix;
  }

  let row = 1;
  let col = 1;
  if (exprs.length >= 2) {
    const rowNode = NumberArgs.map(visit(exprs[1]), grid);
    if (rowNode.t === 'err') {
      return rowNode;
    }
    const rowArg = Math.trunc(rowNode.v);

    if (exprs.length === 2 && matrix.v.rowCount === 1 && matrix.v.colCount > 1) {
      col = rowArg;
    } else {
      row = rowArg;
    }
  }

  if (exprs.length === 3) {
    const colNode = NumberArgs.map(visit(exprs[2]), grid);
    if (colNode.t === 'err') {
      return colNode;
    }
    col = Math.trunc(colNode.v);
  }

  if (row <= 0 || col <= 0) {
    return ErrNode.VALUE;
  }
  if (row > matrix.v.rowCount || col > matrix.v.colCount) {
    return ErrNode.REF;
  }

  return {
    t: 'ref',
    v: matrix.v.refs[(row - 1) * matrix.v.colCount + (col - 1)],
  };
}

/**
 * `vlookupFunc` is the implementation of the VLOOKUP function.
 * VLOOKUP(search_key, range, index, [is_sorted]) — vertical lookup by first column.
 */
export function vlookupFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) {
    return ErrNode.NA;
  }

  const lookup = lookupValueFromNode(visit(exprs[0]), grid);
  if (isFormulaError(lookup)) {
    return lookup;
  }

  const matrix = getReferenceMatrixFromExpression(exprs[1], visit, grid);
  if (matrix.t === 'err') {
    return matrix;
  }

  const indexNode = NumberArgs.map(visit(exprs[2]), grid);
  if (indexNode.t === 'err') {
    return indexNode;
  }
  const targetCol = Math.trunc(indexNode.v);
  if (targetCol <= 0) {
    return ErrNode.VALUE;
  }
  if (targetCol > matrix.v.colCount) {
    return ErrNode.REF;
  }

  let isSorted = true;
  if (exprs.length === 4) {
    const sortedNode = BoolArgs.map(visit(exprs[3]), grid);
    if (sortedNode.t === 'err') {
      return sortedNode;
    }
    isSorted = sortedNode.v;
  }

  if (!isSorted) {
    for (let row = 0; row < matrix.v.rowCount; row++) {
      const keyRef = matrix.v.refs[row * matrix.v.colCount];
      const key = lookupValueFromRef(keyRef, grid);
      if (!equalLookupValues(key, lookup)) {
        continue;
      }

      return {
        t: 'ref',
        v: matrix.v.refs[row * matrix.v.colCount + (targetCol - 1)],
      };
    }

    return ErrNode.NA;
  }

  let bestRow = -1;
  let bestCmp = -Infinity;
  for (let row = 0; row < matrix.v.rowCount; row++) {
    const keyRef = matrix.v.refs[row * matrix.v.colCount];
    const key = lookupValueFromRef(keyRef, grid);
    const cmp = compareLookupValues(key, lookup);
    if (cmp <= 0 && cmp > bestCmp) {
      bestCmp = cmp;
      bestRow = row;
    }
  }

  if (bestRow < 0) {
    return ErrNode.NA;
  }

  return {
    t: 'ref',
    v: matrix.v.refs[bestRow * matrix.v.colCount + (targetCol - 1)],
  };
}

/**
 * `hlookupFunc` is the implementation of the HLOOKUP function.
 * HLOOKUP(search_key, range, index, [is_sorted]) — horizontal lookup by first row.
 */
export function hlookupFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) {
    return ErrNode.NA;
  }

  const lookup = lookupValueFromNode(visit(exprs[0]), grid);
  if (isFormulaError(lookup)) {
    return lookup;
  }

  const matrix = getReferenceMatrixFromExpression(exprs[1], visit, grid);
  if (matrix.t === 'err') {
    return matrix;
  }

  const indexNode = NumberArgs.map(visit(exprs[2]), grid);
  if (indexNode.t === 'err') {
    return indexNode;
  }
  const targetRow = Math.trunc(indexNode.v);
  if (targetRow <= 0) {
    return ErrNode.VALUE;
  }
  if (targetRow > matrix.v.rowCount) {
    return ErrNode.REF;
  }

  let isSorted = true;
  if (exprs.length === 4) {
    const sortedNode = BoolArgs.map(visit(exprs[3]), grid);
    if (sortedNode.t === 'err') {
      return sortedNode;
    }
    isSorted = sortedNode.v;
  }

  if (!isSorted) {
    for (let col = 0; col < matrix.v.colCount; col++) {
      const keyRef = matrix.v.refs[col];
      const key = lookupValueFromRef(keyRef, grid);
      if (!equalLookupValues(key, lookup)) {
        continue;
      }

      return {
        t: 'ref',
        v: matrix.v.refs[(targetRow - 1) * matrix.v.colCount + col],
      };
    }

    return ErrNode.NA;
  }

  let bestCol = -1;
  let bestCmp = -Infinity;
  for (let col = 0; col < matrix.v.colCount; col++) {
    const keyRef = matrix.v.refs[col];
    const key = lookupValueFromRef(keyRef, grid);
    const cmp = compareLookupValues(key, lookup);
    if (cmp <= 0 && cmp > bestCmp) {
      bestCmp = cmp;
      bestCol = col;
    }
  }

  if (bestCol < 0) {
    return ErrNode.NA;
  }

  return {
    t: 'ref',
    v: matrix.v.refs[(targetRow - 1) * matrix.v.colCount + bestCol],
  };
}

/**
 * XLOOKUP(search_key, lookup_range, return_range, [if_not_found], [match_mode], [search_mode])
 */
export function xlookupFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 6) {
    return ErrNode.NA;
  }

  const keyNode = visit(exprs[0]);
  if (keyNode.t === 'err') {
    return keyNode;
  }

  const lookupRefs = getRefsFromExpression(exprs[1], visit, grid);
  if (isFormulaError(lookupRefs)) {
    return lookupRefs;
  }

  const returnRefs = getRefsFromExpression(exprs[2], visit, grid);
  if (isFormulaError(returnRefs)) {
    return returnRefs;
  }

  let ifNotFound: EvalNode | null = null;
  if (exprs.length >= 4) {
    ifNotFound = visit(exprs[3]);
  }

  let matchMode = 0; // 0=exact, -1=exact or next smaller, 1=exact or next larger
  if (exprs.length >= 5) {
    const mmNode = NumberArgs.map(visit(exprs[4]), grid);
    if (mmNode.t === 'err') return mmNode;
    matchMode = Math.trunc(mmNode.v);
  }

  const keyVal = keyNode.t === 'num' ? keyNode.v
    : keyNode.t === 'str' ? keyNode.v
    : keyNode.t === 'bool' ? keyNode.v
    : '';
  const keyIsNum = keyNode.t === 'num';

  let matchIdx = -1;

  if (matchMode === 0) {
    // Exact match
    for (let i = 0; i < lookupRefs.v.length; i++) {
      const cellVal = grid?.get(lookupRefs.v[i])?.v || '';
      if (keyIsNum) {
        if (cellVal !== '' && Number(cellVal) === keyVal) {
          matchIdx = i;
          break;
        }
      } else {
        if (String(cellVal).toLowerCase() === String(keyVal).toLowerCase()) {
          matchIdx = i;
          break;
        }
      }
    }
  } else if (matchMode === -1) {
    // Exact or next smaller
    let bestVal = -Infinity;
    for (let i = 0; i < lookupRefs.v.length; i++) {
      const cellVal = grid?.get(lookupRefs.v[i])?.v || '';
      if (keyIsNum) {
        const num = Number(cellVal);
        if (cellVal !== '' && !isNaN(num) && num <= (keyVal as number) && num > bestVal) {
          bestVal = num;
          matchIdx = i;
        }
      }
    }
  } else if (matchMode === 1) {
    // Exact or next larger
    let bestVal = Infinity;
    for (let i = 0; i < lookupRefs.v.length; i++) {
      const cellVal = grid?.get(lookupRefs.v[i])?.v || '';
      if (keyIsNum) {
        const num = Number(cellVal);
        if (cellVal !== '' && !isNaN(num) && num >= (keyVal as number) && num < bestVal) {
          bestVal = num;
          matchIdx = i;
        }
      }
    }
  }

  if (matchIdx === -1) {
    if (ifNotFound) {
      return ifNotFound;
    }
    return ErrNode.NA;
  }

  if (matchIdx >= returnRefs.v.length) {
    return ErrNode.NA;
  }

  const resultVal = grid?.get(returnRefs.v[matchIdx])?.v || '';
  const num = Number(resultVal);
  if (resultVal !== '' && !isNaN(num)) {
    return { t: 'num', v: num };
  }
  return { t: 'str', v: resultVal };
}

/**
 * XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])
 * Returns the relative position of a value in an array.
 */
export function xmatchFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 4) return ErrNode.NA;

  const keyNode = visit(exprs[0]);
  if (keyNode.t === 'err') return keyNode;

  const lookupRefs = getRefsFromExpression(exprs[1], visit, grid);
  if ('t' in lookupRefs && lookupRefs.t === 'err') return lookupRefs as EvalNode;
  if (!('v' in lookupRefs) || !Array.isArray((lookupRefs as { v: string[] }).v)) {
    return ErrNode.VALUE;
  }
  const refs = (lookupRefs as { t: 'refs'; v: string[] }).v;

  let matchMode = 0;
  if (exprs.length >= 3) {
    const mm = NumberArgs.map(visit(exprs[2]), grid);
    if (mm.t === 'err') return mm;
    matchMode = Math.trunc(mm.v);
  }

  const keyVal = keyNode.t === 'num' ? keyNode.v
    : keyNode.t === 'str' ? keyNode.v
    : keyNode.t === 'bool' ? keyNode.v
    : '';
  const keyIsNum = keyNode.t === 'num';

  if (matchMode === 0) {
    // Exact match
    for (let i = 0; i < refs.length; i++) {
      const cellVal = grid?.get(refs[i])?.v || '';
      if (keyIsNum) {
        if (cellVal !== '' && Number(cellVal) === keyVal) {
          return { t: 'num', v: i + 1 };
        }
      } else {
        if (String(cellVal).toLowerCase() === String(keyVal).toLowerCase()) {
          return { t: 'num', v: i + 1 };
        }
      }
    }
    return ErrNode.NA;
  } else if (matchMode === -1) {
    // Exact or next smaller
    let bestIdx = -1;
    let bestVal = -Infinity;
    const numKey = Number(keyVal);
    for (let i = 0; i < refs.length; i++) {
      const cellVal = grid?.get(refs[i])?.v || '';
      const numVal = Number(cellVal);
      if (!isNaN(numVal) && numVal <= numKey && numVal > bestVal) {
        bestVal = numVal;
        bestIdx = i;
      }
    }
    return bestIdx >= 0 ? { t: 'num', v: bestIdx + 1 } : ErrNode.NA;
  } else if (matchMode === 1) {
    // Exact or next larger
    let bestIdx = -1;
    let bestVal = Infinity;
    const numKey = Number(keyVal);
    for (let i = 0; i < refs.length; i++) {
      const cellVal = grid?.get(refs[i])?.v || '';
      const numVal = Number(cellVal);
      if (!isNaN(numVal) && numVal >= numKey && numVal < bestVal) {
        bestVal = numVal;
        bestIdx = i;
      }
    }
    return bestIdx >= 0 ? { t: 'num', v: bestIdx + 1 } : ErrNode.NA;
  } else if (matchMode === 2) {
    // Wildcard match
    const pattern = String(keyVal).replace(/\*/g, '.*').replace(/\?/g, '.');
    const re = new RegExp('^' + pattern + '$', 'i');
    for (let i = 0; i < refs.length; i++) {
      const cellVal = grid?.get(refs[i])?.v || '';
      if (re.test(cellVal)) {
        return { t: 'num', v: i + 1 };
      }
    }
    return ErrNode.NA;
  }
  return ErrNode.NA;
}

/**
 * LOOKUP(search_key, search_range, [result_range]) — searches a sorted range for a key.
 */
export function lookupFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return ErrNode.NA;
  }

  const keyNode = visit(exprs[0]);
  if (keyNode.t === 'err') {
    return keyNode;
  }

  const searchRefs = getRefsFromExpression(exprs[1], visit, grid);
  if (isFormulaError(searchRefs)) {
    return searchRefs;
  }

  let resultRefsList = searchRefs.v;
  if (exprs.length === 3) {
    const rr = getRefsFromExpression(exprs[2], visit, grid);
    if (isFormulaError(rr)) {
      return rr;
    }
    resultRefsList = rr.v;
  }

  const keyVal = keyNode.t === 'num' ? keyNode.v : keyNode.t === 'str' ? keyNode.v : '';
  const keyIsNum = keyNode.t === 'num';

  let matchIdx = -1;
  for (let i = 0; i < searchRefs.v.length; i++) {
    const cellVal = grid?.get(searchRefs.v[i])?.v || '';
    if (keyIsNum) {
      const cellNum = Number(cellVal);
      if (cellVal !== '' && !isNaN(cellNum) && cellNum <= (keyVal as number)) {
        matchIdx = i;
      }
    } else {
      if (cellVal.toLowerCase() <= String(keyVal).toLowerCase()) {
        matchIdx = i;
      }
    }
  }

  if (matchIdx === -1 || matchIdx >= resultRefsList.length) {
    return ErrNode.NA;
  }

  const resultVal = grid?.get(resultRefsList[matchIdx])?.v || '';
  const num = Number(resultVal);
  if (resultVal !== '' && !isNaN(num)) {
    return { t: 'num', v: num };
  }
  return { t: 'str', v: resultVal };
}

/**
 * INDIRECT(ref_string) — returns the reference specified by a text string.
 */
export function indirectFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return ErrNode.NA;
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') {
    return str;
  }

  if (!grid) {
    return ErrNode.REF;
  }

  const ref = str.v.trim();
  const cellVal = grid.get(ref)?.v;
  if (cellVal === undefined) {
    return { t: 'str', v: '' };
  }

  const num = Number(cellVal);
  if (cellVal !== '' && !isNaN(num)) {
    return { t: 'num', v: num };
  }
  return { t: 'str', v: cellVal };
}

/**
 * OFFSET(reference, rows, cols, [height], [width]) — returns a reference offset from a starting reference.
 */
export function offsetFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 5) {
    return ErrNode.NA;
  }

  const refNode = visit(exprs[0]);
  if (refNode.t === 'err') {
    return refNode;
  }
  if (refNode.t !== 'ref' || !grid) {
    return ErrNode.VALUE;
  }

  const rowsNode = NumberArgs.map(visit(exprs[1]), grid);
  if (rowsNode.t === 'err') return rowsNode;
  const colsNode = NumberArgs.map(visit(exprs[2]), grid);
  if (colsNode.t === 'err') return colsNode;

  const rowOffset = Math.trunc(rowsNode.v);
  const colOffset = Math.trunc(colsNode.v);

  // Parse the starting reference
  const refStr = isSrng(refNode.v) ? refNode.v.split(':')[0] : refNode.v;
  const parsed = parseRef(refStr);

  const newRow = parsed.r + rowOffset;
  const newCol = parsed.c + colOffset;

  if (newRow < 1 || newCol < 1) {
    return ErrNode.REF;
  }

  // For single cell OFFSET (no height/width or 1x1)
  const newRef = `${toColumnLabel(newCol)}${newRow}`;
  const cellVal = grid.get(newRef)?.v || '';
  const num = Number(cellVal);
  if (cellVal !== '' && !isNaN(num)) {
    return { t: 'num', v: num };
  }
  return { t: 'str', v: cellVal };
}

/**
 * ROW([reference]) — returns the row number of a reference.
 */
export function rowFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args || args.expr().length === 0) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref') {
    return ErrNode.VALUE;
  }

  const refStr = isSrng(node.v) ? node.v.split(':')[0] : node.v;
  let localRef = refStr;
  if (isCrossSheetRef(refStr)) {
    localRef = parseCrossSheetRef(refStr).localRef;
  }

  try {
    const ref = parseRef(localRef);
    return { t: 'num', v: ref.r };
  } catch {
    return ErrNode.REF;
  }
}

/**
 * COLUMN([reference]) — returns the column number of a reference.
 */
export function columnFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args || args.expr().length === 0) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref') {
    return ErrNode.VALUE;
  }

  const refStr = isSrng(node.v) ? node.v.split(':')[0] : node.v;
  let localRef = refStr;
  if (isCrossSheetRef(refStr)) {
    localRef = parseCrossSheetRef(refStr).localRef;
  }

  try {
    const ref = parseRef(localRef);
    return { t: 'num', v: ref.c };
  } catch {
    return ErrNode.REF;
  }
}

/**
 * ROWS(range) — returns the number of rows in a range.
 */
export function rowsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref') {
    return ErrNode.VALUE;
  }

  if (!isSrng(node.v)) {
    return { t: 'num', v: 1 };
  }

  let localRange = node.v;
  if (isCrossSheetRef(node.v)) {
    localRange = parseCrossSheetRef(node.v).localRef;
  }

  try {
    const [from, to] = parseRange(localRange);
    return { t: 'num', v: Math.abs(to.r - from.r) + 1 };
  } catch {
    return ErrNode.REF;
  }
}

/**
 * COLUMNS(range) — returns the number of columns in a range.
 */
export function columnsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const node = visit(exprs[0]);
  if (node.t === 'err') {
    return node;
  }
  if (node.t !== 'ref') {
    return ErrNode.VALUE;
  }

  if (!isSrng(node.v)) {
    return { t: 'num', v: 1 };
  }

  let localRange = node.v;
  if (isCrossSheetRef(node.v)) {
    localRange = parseCrossSheetRef(node.v).localRef;
  }

  try {
    const [from, to] = parseRange(localRange);
    return { t: 'num', v: Math.abs(to.c - from.c) + 1 };
  } catch {
    return ErrNode.REF;
  }
}

/**
 * ADDRESS(row, column, [abs_num]) — returns a cell reference as a string.
 */
export function addressFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 4) {
    return ErrNode.NA;
  }

  const rowNode = NumberArgs.map(visit(exprs[0]), grid);
  if (rowNode.t === 'err') {
    return rowNode;
  }
  const colNode = NumberArgs.map(visit(exprs[1]), grid);
  if (colNode.t === 'err') {
    return colNode;
  }

  const row = Math.trunc(rowNode.v);
  const col = Math.trunc(colNode.v);
  if (row < 1 || col < 1) {
    return ErrNode.VALUE;
  }

  let absNum = 1;
  if (exprs.length >= 3) {
    const absNode = NumberArgs.map(visit(exprs[2]), grid);
    if (absNode.t === 'err') {
      return absNode;
    }
    absNum = Math.trunc(absNode.v);
  }

  const colLabel = toColumnLabel(col);

  switch (absNum) {
    case 1:
      return { t: 'str', v: `$${colLabel}$${row}` };
    case 2:
      return { t: 'str', v: `${colLabel}$${row}` };
    case 3:
      return { t: 'str', v: `$${colLabel}${row}` };
    case 4:
      return { t: 'str', v: `${colLabel}${row}` };
    default:
      return ErrNode.VALUE;
  }
}

/**
 * HYPERLINK(url, [link_label]) — creates a hyperlink. Returns the label text.
 */
export function hyperlinkFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return ErrNode.NA;
  }

  const url = toStr(visit(exprs[0]), grid);
  if (url.t === 'err') {
    return url;
  }

  if (exprs.length === 2) {
    const label = toStr(visit(exprs[1]), grid);
    if (label.t === 'err') {
      return label;
    }
    return { t: 'str', v: label.v };
  }

  return { t: 'str', v: url.v };
}

/**
 * AREAS(reference) — returns the number of areas in a reference.
 * Simplified: always returns 1 for a single reference.
 */
export function areasFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length !== 1) return ErrNode.NA;
  return { t: 'num', v: 1 };
}

/**
 * SORT(range, [sort_index], [sort_order]) — for single cell returns first sorted value.
 */
export function sortFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) return ErrNode.NA;

  const vals = collectNumericValues(exprs[0], visit, grid);
  if (!Array.isArray(vals)) return vals;
  if (vals.length === 0) return ErrNode.VALUE;

  let order = 1;
  if (exprs.length >= 3) {
    const orderNode = NumberArgs.map(visit(exprs[2]), grid);
    if (orderNode.t === 'err') return orderNode;
    order = orderNode.v;
  }

  vals.sort((a, b) => order >= 0 ? a - b : b - a);
  return { t: 'num', v: vals[0] };
}

/**
 * SORTBY(array, by_array, [sort_order], ...) — sorts range by another range.
 * Returns top-left value after sorting.
 */
export function sortbyFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2) return ErrNode.NA;

  const m = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m && m.t === 'err') return m;
  if (m.t !== 'matrix') return ErrNode.VALUE;

  const byRefs = getRefsFromExpression(exprs[1], visit, grid);
  if ('t' in byRefs && byRefs.t === 'err') return byRefs as EvalNode;
  const byArr = (byRefs as { t: 'refs'; v: string[] }).v;

  let sortOrder = 1;
  if (exprs.length >= 3) {
    const so = NumberArgs.map(visit(exprs[2]), grid);
    if (so.t === 'err') return so;
    sortOrder = so.v === -1 ? -1 : 1;
  }

  // Build row indices with sort keys
  const rows: { idx: number; key: string }[] = [];
  for (let r = 0; r < m.v.rowCount; r++) {
    const keyIdx = r < byArr.length ? r : byArr.length - 1;
    const key = grid?.get(byArr[keyIdx])?.v ?? '';
    rows.push({ idx: r, key });
  }

  rows.sort((a, b) => {
    const aNum = Number(a.key);
    const bNum = Number(b.key);
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return (aNum - bNum) * sortOrder;
    }
    return a.key.localeCompare(b.key) * sortOrder;
  });

  // Return value from top-left of sorted result
  const sortedRow = rows[0].idx;
  const cellVal = grid?.get(m.v.refs[sortedRow * m.v.colCount])?.v ?? '';
  return cellVal !== '' && !isNaN(Number(cellVal))
    ? { t: 'num', v: Number(cellVal) }
    : { t: 'str', v: cellVal };
}

/**
 * UNIQUE(range) — for single cell returns the first unique value.
 */
export function uniqueFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length !== 1) return ErrNode.NA;

  const node = visit(exprs[0]);
  if (node.t === 'err') return node;
  if (node.t !== 'ref' || !grid) return node;
  return firstCellValue(node, grid);
}

/**
 * FLATTEN(range) — for single cell returns the first value.
 */
export function flattenFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length !== 1) return ErrNode.NA;

  const node = visit(exprs[0]);
  if (node.t === 'err') return node;
  if (node.t !== 'ref' || !grid) return node;
  return firstCellValue(node, grid);
}

/**
 * TRANSPOSE(range) — for single cell returns the value itself.
 */
export function transposeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length !== 1) return ErrNode.NA;

  const node = visit(exprs[0]);
  if (node.t === 'err') return node;
  if (node.t !== 'ref' || !grid) return node;
  return firstCellValue(node, grid);
}

/**
 * FILTER(array, include, [if_empty]) — filters rows based on criteria.
 * Returns first matching row's first value for single-cell evaluation.
 */
export function filterFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return ErrNode.NA;

  const m = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m && m.t === 'err') return m;
  if (m.t !== 'matrix') return ErrNode.VALUE;

  const includeRefs = getRefsFromExpression(exprs[1], visit, grid);
  if ('t' in includeRefs && includeRefs.t === 'err') return includeRefs as EvalNode;
  const includes = (includeRefs as { t: 'refs'; v: string[] }).v;

  // Find first row where include is truthy
  for (let r = 0; r < m.v.rowCount; r++) {
    const includeIdx = r < includes.length ? r : includes.length - 1;
    const incVal = grid?.get(includes[includeIdx])?.v ?? '';
    const isTruthy = incVal === 'TRUE' || incVal === '1' || (incVal !== '' && incVal !== '0' && incVal !== 'FALSE');
    if (isTruthy) {
      const cellVal = grid?.get(m.v.refs[r * m.v.colCount])?.v ?? '';
      return cellVal !== '' && !isNaN(Number(cellVal))
        ? { t: 'num', v: Number(cellVal) }
        : { t: 'str', v: cellVal };
    }
  }

  // No match found
  if (exprs.length >= 3) {
    return visit(exprs[2]);
  }
  return ErrNode.NA;
}

/**
 * SEQUENCE(rows, [columns], [start], [step]) — returns start value for single cell.
 */
export function sequenceFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 4) return ErrNode.NA;

  const rowsNode = NumberArgs.map(visit(exprs[0]), grid);
  if (rowsNode.t === 'err') return rowsNode;
  if (rowsNode.v < 1) return ErrNode.VALUE;

  let start = 1;
  if (exprs.length >= 3) {
    const startNode = NumberArgs.map(visit(exprs[2]), grid);
    if (startNode.t === 'err') return startNode;
    start = startNode.v;
  }

  // Single-cell: return the start value
  return { t: 'num', v: start };
}

/**
 * RANDARRAY([rows], [columns], [min], [max], [whole_number]) — returns random for single cell.
 */
export function randarrayFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  const exprs = args ? args.expr() : [];
  if (exprs.length > 5) return ErrNode.NA;

  let min = 0, max = 1, whole = false;
  if (exprs.length >= 3) {
    const minNode = NumberArgs.map(visit(exprs[2]), grid);
    if (minNode.t === 'err') return minNode;
    min = minNode.v;
  }
  if (exprs.length >= 4) {
    const maxNode = NumberArgs.map(visit(exprs[3]), grid);
    if (maxNode.t === 'err') return maxNode;
    max = maxNode.v;
  }
  if (exprs.length >= 5) {
    const wholeNode = BoolArgs.map(visit(exprs[4]), grid);
    if (wholeNode.t === 'err') return wholeNode;
    whole = wholeNode.v;
  }

  if (min > max) return ErrNode.VALUE;

  const val = min + Math.random() * (max - min);
  return { t: 'num', v: whole ? Math.floor(val) : val };
}

/**
 * TOCOL(array, [ignore], [scan_by_column]) — flattens a range to a single column.
 * Returns all values as comma-separated string for single-cell evaluation.
 */
export function tocolFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) return ErrNode.NA;

  const m = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m && m.t === 'err') return m;
  if (m.t !== 'matrix') return ErrNode.VALUE;

  let ignore = 0; // 0=keep all, 1=ignore blanks, 2=ignore errors, 3=ignore blanks+errors
  if (exprs.length >= 2) {
    const ig = NumberArgs.map(visit(exprs[1]), grid);
    if (ig.t === 'err') return ig;
    ignore = Math.trunc(ig.v);
  }

  let scanByCol = false;
  if (exprs.length >= 3) {
    const sc = visit(exprs[2]);
    scanByCol = sc.t === 'bool' ? sc.v === true : sc.t === 'num' ? sc.v !== 0 : false;
  }

  const values: string[] = [];
  const { refs, rowCount, colCount } = m.v;
  if (scanByCol) {
    for (let c = 0; c < colCount; c++) {
      for (let r = 0; r < rowCount; r++) {
        const val = grid?.get(refs[r * colCount + c])?.v ?? '';
        if (ignore === 1 && val === '') continue;
        values.push(val);
      }
    }
  } else {
    for (const ref of refs) {
      const val = grid?.get(ref)?.v ?? '';
      if (ignore === 1 && val === '') continue;
      values.push(val);
    }
  }

  // Return first value for single-cell evaluation
  return values.length > 0
    ? { t: 'str', v: values[0] }
    : ErrNode.NA;
}

/**
 * TOROW(array, [ignore], [scan_by_column]) — flattens a range to a single row.
 * Identical to TOCOL in single-cell evaluation context.
 */
export function torowFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  return tocolFunc(ctx, visit, grid);
}

/**
 * CHOOSEROWS(array, row_num1, [row_num2], ...) — returns specified rows.
 * Returns the value at the first chosen row, first column.
 */
export function chooserowsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2) return ErrNode.NA;

  const m = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m && m.t === 'err') return m;
  if (m.t !== 'matrix') return ErrNode.VALUE;

  const rowNum = NumberArgs.map(visit(exprs[1]), grid);
  if (rowNum.t === 'err') return rowNum;
  let r = Math.trunc(rowNum.v);
  if (r < 0) r = m.v.rowCount + r + 1; // negative = from end
  if (r < 1 || r > m.v.rowCount) return ErrNode.VALUE;

  const refIdx = (r - 1) * m.v.colCount;
  const cellVal = grid?.get(m.v.refs[refIdx])?.v ?? '';
  return cellVal !== '' && !isNaN(Number(cellVal))
    ? { t: 'num', v: Number(cellVal) }
    : { t: 'str', v: cellVal };
}

/**
 * CHOOSECOLS(array, col_num1, [col_num2], ...) — returns specified columns.
 * Returns the value at the first row, first chosen column.
 */
export function choosecolsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2) return ErrNode.NA;

  const m = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m && m.t === 'err') return m;
  if (m.t !== 'matrix') return ErrNode.VALUE;

  const colNum = NumberArgs.map(visit(exprs[1]), grid);
  if (colNum.t === 'err') return colNum;
  let c = Math.trunc(colNum.v);
  if (c < 0) c = m.v.colCount + c + 1;
  if (c < 1 || c > m.v.colCount) return ErrNode.VALUE;

  const refIdx = c - 1; // first row, chosen column
  const cellVal = grid?.get(m.v.refs[refIdx])?.v ?? '';
  return cellVal !== '' && !isNaN(Number(cellVal))
    ? { t: 'num', v: Number(cellVal) }
    : { t: 'str', v: cellVal };
}

/**
 * TAKE(array, rows, [columns]) — returns specified number of rows/columns from start/end.
 * Positive = from start, negative = from end.
 */
export function takeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return ErrNode.NA;

  const m = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m && m.t === 'err') return m;
  if (m.t !== 'matrix') return ErrNode.VALUE;

  const rowsNode = NumberArgs.map(visit(exprs[1]), grid);
  if (rowsNode.t === 'err') return rowsNode;
  const takeRows = Math.trunc(rowsNode.v);
  if (takeRows === 0) return ErrNode.VALUE;

  // Determine starting row
  const startRow = takeRows > 0 ? 0 : m.v.rowCount + takeRows;
  if (startRow < 0 || startRow >= m.v.rowCount) return ErrNode.VALUE;

  // Determine starting col
  let startCol = 0;
  if (exprs.length >= 3) {
    const colsNode = NumberArgs.map(visit(exprs[2]), grid);
    if (colsNode.t === 'err') return colsNode;
    const takeCols = Math.trunc(colsNode.v);
    if (takeCols === 0) return ErrNode.VALUE;
    startCol = takeCols > 0 ? 0 : m.v.colCount + takeCols;
    if (startCol < 0 || startCol >= m.v.colCount) return ErrNode.VALUE;
  }

  const refIdx = startRow * m.v.colCount + startCol;
  const cellVal = grid?.get(m.v.refs[refIdx])?.v ?? '';
  return cellVal !== '' && !isNaN(Number(cellVal))
    ? { t: 'num', v: Number(cellVal) }
    : { t: 'str', v: cellVal };
}

/**
 * DROP(array, rows, [columns]) — removes specified number of rows/columns.
 * Positive = from start, negative = from end.
 */
export function dropFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return ErrNode.NA;

  const m = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m && m.t === 'err') return m;
  if (m.t !== 'matrix') return ErrNode.VALUE;

  const rowsNode = NumberArgs.map(visit(exprs[1]), grid);
  if (rowsNode.t === 'err') return rowsNode;
  const dropRows = Math.trunc(rowsNode.v);

  // First remaining row after drop
  const startRow = dropRows >= 0 ? dropRows : 0;
  if (startRow >= m.v.rowCount) return ErrNode.VALUE;

  let startCol = 0;
  if (exprs.length >= 3) {
    const colsNode = NumberArgs.map(visit(exprs[2]), grid);
    if (colsNode.t === 'err') return colsNode;
    const dropCols = Math.trunc(colsNode.v);
    startCol = dropCols >= 0 ? dropCols : 0;
    if (startCol >= m.v.colCount) return ErrNode.VALUE;
  }

  const refIdx = startRow * m.v.colCount + startCol;
  const cellVal = grid?.get(m.v.refs[refIdx])?.v ?? '';
  return cellVal !== '' && !isNaN(Number(cellVal))
    ? { t: 'num', v: Number(cellVal) }
    : { t: 'str', v: cellVal };
}

/**
 * HSTACK(range1, range2, ...) — appends arrays horizontally.
 * Returns top-left value of first range.
 */
export function hstackFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 1) return ErrNode.NA;

  const m = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m && m.t === 'err') return m;
  if (m.t !== 'matrix') return ErrNode.VALUE;

  const cellVal = grid?.get(m.v.refs[0])?.v ?? '';
  return cellVal !== '' && !isNaN(Number(cellVal))
    ? { t: 'num', v: Number(cellVal) }
    : { t: 'str', v: cellVal };
}

/**
 * VSTACK(range1, range2, ...) — appends arrays vertically.
 * Returns top-left value of first range.
 */
export function vstackFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  return hstackFunc(ctx, visit, grid);
}

/**
 * WRAPCOLS(vector, wrap_count, [pad_with]) — wraps a row/column into columns.
 * Returns first value.
 */
export function wrapcolsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2) return ErrNode.NA;

  const m = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m && m.t === 'err') return m;
  if (m.t !== 'matrix') return ErrNode.VALUE;

  const wrapNode = NumberArgs.map(visit(exprs[1]), grid);
  if (wrapNode.t === 'err') return wrapNode;
  if (wrapNode.v < 1) return ErrNode.VALUE;

  const cellVal = grid?.get(m.v.refs[0])?.v ?? '';
  return cellVal !== '' && !isNaN(Number(cellVal))
    ? { t: 'num', v: Number(cellVal) }
    : { t: 'str', v: cellVal };
}

/**
 * WRAPROWS(vector, wrap_count, [pad_with]) — wraps a row/column into rows.
 * Returns first value.
 */
export function wraprowsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  return wrapcolsFunc(ctx, visit, grid);
}

/**
 * EXPAND(array, rows, [columns], [pad_with]) — expands array to specified dimensions.
 * Returns top-left value for single-cell evaluation.
 */
export function expandFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 4) return ErrNode.NA;

  const m = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m && m.t === 'err') return m;
  if (m.t !== 'matrix') return ErrNode.VALUE;

  const cellVal = grid?.get(m.v.refs[0])?.v ?? '';
  return cellVal !== '' && !isNaN(Number(cellVal))
    ? { t: 'num', v: Number(cellVal) }
    : { t: 'str', v: cellVal };
}

/**
 * Helper: get the first cell value from a ref node.
 */
function firstCellValue(node: EvalNode, grid: Grid): EvalNode {
  if (node.t !== 'ref') return node;
  const firstRef = toSrefs([node.v]).next().value;
  if (!firstRef) return { t: 'str', v: '' };
  const cell = grid.get(firstRef);
  const val = cell?.v || '';
  if (val === '') return { t: 'str', v: '' };
  if (!isNaN(Number(val))) return { t: 'num', v: Number(val) };
  return { t: 'str', v: val };
}

export const lookupEntries: [string, (...args: any[]) => EvalNode][] = [
  ['MATCH', matchFunc],
  ['INDEX', indexFunc],
  ['VLOOKUP', vlookupFunc],
  ['HLOOKUP', hlookupFunc],
  ['XLOOKUP', xlookupFunc],
  ['XMATCH', xmatchFunc],
  ['LOOKUP', lookupFunc],
  ['INDIRECT', indirectFunc],
  ['OFFSET', offsetFunc],
  ['ROW', rowFunc],
  ['COLUMN', columnFunc],
  ['ROWS', rowsFunc],
  ['COLUMNS', columnsFunc],
  ['ADDRESS', addressFunc],
  ['HYPERLINK', hyperlinkFunc],
  ['AREAS', areasFunc],
  ['SORT', sortFunc],
  ['SORTBY', sortbyFunc],
  ['UNIQUE', uniqueFunc],
  ['FLATTEN', flattenFunc],
  ['TRANSPOSE', transposeFunc],
  ['FILTER', filterFunc],
  ['SEQUENCE', sequenceFunc],
  ['RANDARRAY', randarrayFunc],
  ['TOCOL', tocolFunc],
  ['TOROW', torowFunc],
  ['CHOOSEROWS', chooserowsFunc],
  ['CHOOSECOLS', choosecolsFunc],
  ['TAKE', takeFunc],
  ['DROP', dropFunc],
  ['HSTACK', hstackFunc],
  ['VSTACK', vstackFunc],
  ['WRAPCOLS', wrapcolsFunc],
  ['WRAPROWS', wraprowsFunc],
  ['EXPAND', expandFunc],
];
