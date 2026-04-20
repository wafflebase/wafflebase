import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { ErrValue, ErrValues, EvalNode, ErrNode, errValueCode } from './formula';
import { NumberArgs } from './arguments';
import { Grid } from '../model/core/types';
import {
  isSrng,
  parseRef,
  toColumnLabel,
  toSref,
} from '../model/core/coordinates';
import {
  toStr,
} from './functions-helpers';

/**
 * `isblankFunc` is the implementation of the ISBLANK function.
 * ISBLANK(value) — returns TRUE when the value is an empty cell reference.
 */
export function isblankFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
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
  if (node.t !== 'ref' || !grid) {
    return { t: 'bool', v: false };
  }
  if (isSrng(node.v)) {
    return ErrNode.VALUE;
  }

  const value = grid.get(node.v)?.v || '';
  return { t: 'bool', v: value === '' };
}

/**
 * `isnumberFunc` is the implementation of the ISNUMBER function.
 * ISNUMBER(value) — returns TRUE when value is numeric.
 */
export function isnumberFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
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
  if (node.t === 'num') {
    return { t: 'bool', v: true };
  }
  if (node.t !== 'ref' || !grid) {
    return { t: 'bool', v: false };
  }
  if (isSrng(node.v)) {
    return ErrNode.VALUE;
  }

  const value = grid.get(node.v)?.v || '';
  const upper = value.toUpperCase();
  const isBoolean = upper === 'TRUE' || upper === 'FALSE';
  return {
    t: 'bool',
    v: value !== '' && !isBoolean && !isNaN(Number(value)),
  };
}

/**
 * `istextFunc` is the implementation of the ISTEXT function.
 * ISTEXT(value) — returns TRUE when value is text.
 */
export function istextFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
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
  if (node.t === 'str') {
    return { t: 'bool', v: true };
  }
  if (node.t !== 'ref' || !grid) {
    return { t: 'bool', v: false };
  }
  if (isSrng(node.v)) {
    return ErrNode.VALUE;
  }

  const value = grid.get(node.v)?.v || '';
  if (value === '') {
    return { t: 'bool', v: false };
  }

  const upper = value.toUpperCase();
  const isBoolean = upper === 'TRUE' || upper === 'FALSE';
  const isNumeric = !isNaN(Number(value));
  return { t: 'bool', v: !isBoolean && !isNumeric };
}

/**
 * `iserrorFunc` is the implementation of the ISERROR function.
 * ISERROR(value) — returns TRUE if the value is any error.
 */
export function iserrorFunc(
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

  const value = visit(exprs[0]);
  return { t: 'bool', v: value.t === 'err' };
}

/**
 * `iserrFunc` is the implementation of the ISERR function.
 * ISERR(value) — returns TRUE for all errors except #N/A.
 */
export function iserrFunc(
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

  const value = visit(exprs[0]);
  return { t: 'bool', v: value.t === 'err' && value.v !== ErrValue.NA };
}

/**
 * `isnaFunc` is the implementation of the ISNA function.
 * ISNA(value) — returns TRUE only for #N/A errors.
 */
export function isnaFunc(
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

  const value = visit(exprs[0]);
  return { t: 'bool', v: value.t === 'err' && value.v === ErrValue.NA };
}

/**
 * `islogicalFunc` is the implementation of the ISLOGICAL function.
 * ISLOGICAL(value) — returns TRUE when value is a boolean.
 */
export function islogicalFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
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
  if (node.t === 'bool') {
    return { t: 'bool', v: true };
  }
  if (node.t !== 'ref' || !grid) {
    return { t: 'bool', v: false };
  }
  if (isSrng(node.v)) {
    return ErrNode.VALUE;
  }

  const value = grid.get(node.v)?.v || '';
  const upper = value.toUpperCase();
  return { t: 'bool', v: upper === 'TRUE' || upper === 'FALSE' };
}

/**
 * `isnontextFunc` is the implementation of the ISNONTEXT function.
 * ISNONTEXT(value) — returns TRUE when value is not text.
 */
export function isnontextFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
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
    return { t: 'bool', v: true };
  }
  if (node.t === 'str') {
    return { t: 'bool', v: false };
  }
  if (node.t === 'num' || node.t === 'bool') {
    return { t: 'bool', v: true };
  }
  if (node.t !== 'ref' || !grid) {
    return { t: 'bool', v: false };
  }
  if (isSrng(node.v)) {
    return ErrNode.VALUE;
  }

  const value = grid.get(node.v)?.v || '';
  if (value === '') {
    return { t: 'bool', v: true };
  }

  const upper = value.toUpperCase();
  const isBoolean = upper === 'TRUE' || upper === 'FALSE';
  const isNumeric = !isNaN(Number(value));
  return { t: 'bool', v: isBoolean || isNumeric };
}

/**
 * ISEVEN(number) — checks whether a number is even.
 */
export function isevenFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length !== 1) return ErrNode.NA;
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'bool', v: Math.trunc(num.v) % 2 === 0 };
}

/**
 * ISODD(number) — checks whether a number is odd.
 */
export function isoddFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length !== 1) return ErrNode.NA;
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'bool', v: Math.trunc(num.v) % 2 !== 0 };
}

/**
 * ISDATE(value) — checks whether a value is a date.
 */
export function isdateFunc(
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
    return { t: 'bool', v: false };
  }

  if (node.t !== 'str' || node.v === '') {
    return { t: 'bool', v: false };
  }

  // Only accept strings with date-like separators (-, /)
  if (!/[\-\/]/.test(node.v)) {
    return { t: 'bool', v: false };
  }

  const d = new Date(node.v);
  return { t: 'bool', v: !isNaN(d.getTime()) };
}

/**
 * ISURL(value) — returns TRUE if the value looks like a URL.
 */
export function isurlFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length !== 1) return ErrNode.NA;

  const node = visit(exprs[0]);
  const s = toStr(node, grid);
  if (s.t === 'err') return s;
  const v = s.v.trim();
  const isUrl = /^https?:\/\//i.test(v) || /^ftp:\/\//i.test(v);
  return { t: 'bool', v: isUrl };
}

/**
 * ISFORMULA(cell) — returns TRUE if the referenced cell contains a formula.
 */
export function isformulaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length !== 1) return ErrNode.NA;

  const node = visit(exprs[0]);
  if (node.t !== 'ref' || !grid) return { t: 'bool', v: false };
  if (isSrng(node.v)) return ErrNode.VALUE;

  const cell = grid.get(node.v);
  return { t: 'bool', v: !!(cell && cell.f) };
}

/**
 * ISREF(value) — returns TRUE if the value is a reference.
 */
export function isrefFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length !== 1) return ErrNode.NA;

  const node = visit(exprs[0]);
  return { t: 'bool', v: node.t === 'ref' };
}

/**
 * N(value) — converts a value to a number.
 */
export function nFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
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
  if (node.t === 'num') {
    return node;
  }
  if (node.t === 'bool') {
    return { t: 'num', v: node.v ? 1 : 0 };
  }
  if (node.t === 'ref' && grid) {
    const value = grid.get(node.v)?.v || '';
    if (value === '') {
      return { t: 'num', v: 0 };
    }
    const upper = value.toUpperCase();
    if (upper === 'TRUE') return { t: 'num', v: 1 };
    if (upper === 'FALSE') return { t: 'num', v: 0 };
    const num = Number(value);
    return { t: 'num', v: isNaN(num) ? 0 : num };
  }

  return { t: 'num', v: 0 };
}

/**
 * NA() — returns the #N/A error value.
 */
export function naFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return ErrNode.NA;
  }

  return ErrNode.NA;
}

/**
 * TYPE(value) — returns a number indicating the data type of a value.
 * 1=number, 2=text, 4=boolean, 16=error, 64=array.
 */
export function typeFunc(
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
  switch (node.t) {
    case 'num':
      return { t: 'num', v: 1 };
    case 'str':
      return { t: 'num', v: 2 };
    case 'bool':
      return { t: 'num', v: 4 };
    case 'err':
      return { t: 'num', v: 16 };
    case 'ref':
      return { t: 'num', v: 1 }; // Cell refs are treated as number by default
    default:
      return { t: 'num', v: 1 };
  }
}

/**
 * ERROR.TYPE(value) — returns the 1-based error code from `ErrValues`
 * (1 = #NULL!, …, 8 = #ERROR!). Non-error input returns #N/A. Accepts a
 * single-cell reference; the cell's stored value is inspected as an error
 * literal (e.g. a formula that previously evaluated to `#DIV/0!`).
 */
export function errortypeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
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
  const errValue = resolveErrValue(node, grid);
  if (errValue !== undefined) {
    return { t: 'num', v: errValueCode(errValue) };
  }

  return ErrNode.NA;
}

function resolveErrValue(node: EvalNode, grid?: Grid): ErrValue | undefined {
  if (node.t === 'err') {
    return errValueCode(node.v) > 0 ? node.v : undefined;
  }
  if (node.t === 'ref' && grid && !isSrng(node.v)) {
    const stored = grid.get(node.v)?.v;
    if (stored && (ErrValues as readonly string[]).includes(stored)) {
      return stored as ErrValue;
    }
  }
  return undefined;
}

/**
 * FORMULATEXT(cell) — returns the formula string of the referenced cell.
 */
export function formulatextFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length !== 1) return ErrNode.NA;

  const node = visit(exprs[0]);
  if (node.t !== 'ref' || !grid) return ErrNode.NA;
  if (isSrng(node.v)) return ErrNode.VALUE;

  const cell = grid.get(node.v);
  if (!cell || !cell.f) return ErrNode.NA;
  return { t: 'str', v: cell.f };
}

/**
 * CELL(info_type, [reference]) — returns information about a cell.
 * Simplified: supports "row", "col", "address" for a reference.
 */
export function cellInfoFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return ErrNode.NA;
  const infoType = toStr(visit(exprs[0]), grid);
  if (infoType.t === 'err') return infoType;
  const typeStr = infoType.v.toLowerCase();
  if (exprs.length < 2) {
    // No reference, return info about default
    if (typeStr === 'row') return { t: 'num', v: 1 };
    if (typeStr === 'col') return { t: 'num', v: 1 };
    return { t: 'str', v: '' };
  }
  const refNode = visit(exprs[1]);
  if (refNode.t !== 'ref') return ErrNode.VALUE;
  const refStr = typeof refNode.v === 'string' ? refNode.v : '';
  // Parse the reference
  const rangeMatch = refStr.match(/^([A-Z]+)(\d+)/i);
  if (!rangeMatch) return ErrNode.VALUE;
  const ref = parseRef(rangeMatch[0]);
  switch (typeStr) {
    case 'row': return { t: 'num', v: ref.r };
    case 'col': return { t: 'num', v: ref.c };
    case 'address': return { t: 'str', v: '$' + toColumnLabel(ref.c) + '$' + ref.r };
    case 'contents': {
      if (!grid) return { t: 'str', v: '' };
      const cell = grid.get(toSref(ref));
      return cell?.v != null ? { t: 'str', v: cell.v } : { t: 'str', v: '' };
    }
    default: return { t: 'str', v: '' };
  }
}

/**
 * SHEET([value]) — returns 1 (single sheet).
 */
export function sheetFunc(
  _ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  return { t: 'num', v: 1 };
}

/**
 * SHEETS([reference]) — returns 1 (single sheet).
 */
export function sheetsFunc(
  _ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  return { t: 'num', v: 1 };
}

function emptyArgFunc(): EvalNode {
  return { t: 'empty' };
}

export const infoEntries: [string, (...args: any[]) => EvalNode][] = [
  ['ISBLANK', isblankFunc],
  ['ISNUMBER', isnumberFunc],
  ['ISTEXT', istextFunc],
  ['ISERROR', iserrorFunc],
  ['ISERR', iserrFunc],
  ['ISNA', isnaFunc],
  ['ISLOGICAL', islogicalFunc],
  ['ISNONTEXT', isnontextFunc],
  ['ISEVEN', isevenFunc],
  ['ISODD', isoddFunc],
  ['ISDATE', isdateFunc],
  ['ISURL', isurlFunc],
  ['ISFORMULA', isformulaFunc],
  ['ISREF', isrefFunc],
  ['N', nFunc],
  ['NA', naFunc],
  ['TYPE', typeFunc],
  ['ERROR.TYPE', errortypeFunc],
  ['FORMULATEXT', formulatextFunc],
  ['CELL', cellInfoFunc],
  ['SHEET', sheetFunc],
  ['SHEETS', sheetsFunc],
  ['ZEMPTYARG__', emptyArgFunc],
];
