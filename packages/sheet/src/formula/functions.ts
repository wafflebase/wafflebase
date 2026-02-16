import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode } from './formula';
import { NumberArgs, BoolArgs, ref2str } from './arguments';
import { Grid } from '../model/types';
import { isSrng, toSrefs } from '../model/coordinates';

/**
 * FunctionMap is a map of function name to the function implementation.
 */
export const FunctionMap = new Map([
  ['SUM', sum],
  ['IF', ifFunc],
  ['AND', andFunc],
  ['OR', orFunc],
  ['NOT', notFunc],
  ['AVERAGE', average],
  ['MIN', minFunc],
  ['MAX', maxFunc],
  ['COUNT', countFunc],
  ['COUNTA', countaFunc],
  ['TRIM', trimFunc],
  ['LEN', lenFunc],
  ['LEFT', leftFunc],
  ['RIGHT', rightFunc],
  ['MID', midFunc],
  ['CONCATENATE', concatenateFunc],
  ['TODAY', todayFunc],
  ['NOW', nowFunc],
  ['YEAR', yearFunc],
  ['MONTH', monthFunc],
  ['DAY', dayFunc],
  ['IFERROR', iferrorFunc],
]);

/**
 * `sum` is the implementation of the SUM function.
 */
export function sum(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let value = 0;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }

    value += node.v;
  }

  return {
    t: 'num',
    v: value,
  };
}

/**
 * `ifFunc` is the implementation of the IF function.
 * IF(condition, value_if_true, [value_if_false])
 */
export function ifFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const condition = BoolArgs.map(visit(exprs[0]), grid);
  if (condition.t === 'err') {
    return condition;
  }

  if (condition.v) {
    return visit(exprs[1]);
  }

  if (exprs.length === 3) {
    return visit(exprs[2]);
  }

  return { t: 'bool', v: false };
}

/**
 * `andFunc` is the implementation of the AND function.
 * AND(val1, val2, ...) — returns TRUE if all arguments are truthy.
 */
export function andFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  for (const node of BoolArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }

    if (!node.v) {
      return { t: 'bool', v: false };
    }
  }

  return { t: 'bool', v: true };
}

/**
 * `orFunc` is the implementation of the OR function.
 * OR(val1, val2, ...) — returns TRUE if any argument is truthy.
 */
export function orFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  for (const node of BoolArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }

    if (node.v) {
      return { t: 'bool', v: true };
    }
  }

  return { t: 'bool', v: false };
}

/**
 * `notFunc` is the implementation of the NOT function.
 * NOT(value) — returns the opposite boolean value.
 */
export function notFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = BoolArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }

  return { t: 'bool', v: !value.v };
}

/**
 * `average` is the implementation of the AVERAGE function.
 * AVERAGE(number1, [number2], ...) — returns the arithmetic mean.
 */
export function average(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let sum = 0;
  let count = 0;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    sum += node.v;
    count++;
  }

  if (count === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: sum / count };
}

/**
 * `minFunc` is the implementation of the MIN function.
 * MIN(number1, [number2], ...) — returns the smallest value.
 */
export function minFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let result = Infinity;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    if (node.v < result) {
      result = node.v;
    }
  }

  return { t: 'num', v: result };
}

/**
 * `maxFunc` is the implementation of the MAX function.
 * MAX(number1, [number2], ...) — returns the largest value.
 */
export function maxFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let result = -Infinity;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    if (node.v > result) {
      result = node.v;
    }
  }

  return { t: 'num', v: result };
}

/**
 * `countFunc` is the implementation of the COUNT function.
 * COUNT(value1, [value2], ...) — counts numeric values only.
 */
export function countFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let count = 0;
  for (const expr of args.expr()) {
    const node = visit(expr);
    if (node.t === 'num') {
      count++;
    } else if (node.t === 'bool') {
      count++;
    } else if (node.t === 'ref' && grid) {
      if (isSrng(node.v)) {
        for (const ref of toSrefs([node.v])) {
          const val = grid.get(ref)?.v || '';
          if (val !== '' && !isNaN(Number(val))) {
            count++;
          }
        }
      } else {
        const val = grid.get(node.v)?.v || '';
        if (val !== '' && !isNaN(Number(val))) {
          count++;
        }
      }
    }
    // strings that aren't numeric are skipped
  }

  return { t: 'num', v: count };
}

/**
 * `countaFunc` is the implementation of the COUNTA function.
 * COUNTA(value1, [value2], ...) — counts non-empty values.
 */
export function countaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let count = 0;
  for (const expr of args.expr()) {
    const node = visit(expr);
    if (node.t === 'num' || node.t === 'bool') {
      count++;
    } else if (node.t === 'str') {
      if (node.v !== '') {
        count++;
      }
    } else if (node.t === 'ref' && grid) {
      if (isSrng(node.v)) {
        for (const ref of toSrefs([node.v])) {
          const val = grid.get(ref)?.v || '';
          if (val !== '') {
            count++;
          }
        }
      } else {
        const val = grid.get(node.v)?.v || '';
        if (val !== '') {
          count++;
        }
      }
    }
  }

  return { t: 'num', v: count };
}

/**
 * `toStr` converts an EvalNode to a string, propagating errors.
 */
function toStr(
  node: EvalNode,
  grid?: Grid,
):
  | { t: 'str'; v: string }
  | { t: 'err'; v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!' } {
  if (node.t === 'err') return node;
  if (node.t === 'str') return node;
  if (node.t === 'num') return { t: 'str', v: node.v.toString() };
  if (node.t === 'bool') return { t: 'str', v: node.v ? 'TRUE' : 'FALSE' };
  if (node.t === 'ref' && grid) {
    return ref2str(node, grid);
  }
  return { t: 'err', v: '#VALUE!' };
}

/**
 * `trimFunc` is the implementation of the TRIM function.
 * TRIM(text) — removes leading and trailing whitespace.
 */
export function trimFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;

  return { t: 'str', v: str.v.trim() };
}

/**
 * `lenFunc` is the implementation of the LEN function.
 * LEN(text) — returns the length of a string.
 */
export function lenFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;

  return { t: 'num', v: str.v.length };
}

/**
 * `leftFunc` is the implementation of the LEFT function.
 * LEFT(text, [num_chars]) — returns leftmost characters.
 */
export function leftFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;

  let n = 1;
  if (exprs.length === 2) {
    const numNode = NumberArgs.map(visit(exprs[1]), grid);
    if (numNode.t === 'err') return numNode;
    n = numNode.v;
  }

  return { t: 'str', v: str.v.slice(0, n) };
}

/**
 * `rightFunc` is the implementation of the RIGHT function.
 * RIGHT(text, [num_chars]) — returns rightmost characters.
 */
export function rightFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;

  let n = 1;
  if (exprs.length === 2) {
    const numNode = NumberArgs.map(visit(exprs[1]), grid);
    if (numNode.t === 'err') return numNode;
    n = numNode.v;
  }

  return { t: 'str', v: str.v.slice(-n) };
}

/**
 * `midFunc` is the implementation of the MID function.
 * MID(text, start_num, num_chars) — returns characters from the middle.
 */
export function midFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;

  const startNode = NumberArgs.map(visit(exprs[1]), grid);
  if (startNode.t === 'err') return startNode;

  const lenNode = NumberArgs.map(visit(exprs[2]), grid);
  if (lenNode.t === 'err') return lenNode;

  const start = startNode.v - 1; // 1-indexed to 0-indexed
  return { t: 'str', v: str.v.slice(start, start + lenNode.v) };
}

/**
 * `concatenateFunc` is the implementation of the CONCATENATE function.
 * CONCATENATE(string1, string2, ...) — joins strings together.
 */
export function concatenateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2) {
    return { t: 'err', v: '#N/A!' };
  }

  let result = '';
  for (const expr of exprs) {
    const str = toStr(visit(expr), grid);
    if (str.t === 'err') return str;
    result += str.v;
  }

  return { t: 'str', v: result };
}

/**
 * `todayFunc` is the implementation of the TODAY function.
 * TODAY() — returns the current date as YYYY-MM-DD.
 */
export function todayFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return { t: 'err', v: '#N/A!' };
  }

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return { t: 'str', v: `${yyyy}-${mm}-${dd}` };
}

/**
 * `nowFunc` is the implementation of the NOW function.
 * NOW() — returns the current date and time as YYYY-MM-DD HH:MM:SS.
 */
export function nowFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return { t: 'err', v: '#N/A!' };
  }

  const now = new Date();
  const yyyy = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return { t: 'str', v: `${yyyy}-${mo}-${dd} ${hh}:${mi}:${ss}` };
}

/**
 * `parseDate` parses a date from an EvalNode, returning a Date or an error.
 */
function parseDate(
  node: EvalNode,
  grid?: Grid,
): Date | { t: 'err'; v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!' } {
  const str = toStr(node, grid);
  if (str.t === 'err') return str;

  const date = new Date(str.v);
  if (isNaN(date.getTime())) {
    return { t: 'err', v: '#VALUE!' };
  }
  return date;
}

/**
 * `yearFunc` is the implementation of the YEAR function.
 * YEAR(date) — returns the year from a date.
 */
export function yearFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) return date;

  return { t: 'num', v: date.getFullYear() };
}

/**
 * `monthFunc` is the implementation of the MONTH function.
 * MONTH(date) — returns the month (1-12) from a date.
 */
export function monthFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) return date;

  return { t: 'num', v: date.getMonth() + 1 };
}

/**
 * `dayFunc` is the implementation of the DAY function.
 * DAY(date) — returns the day of the month from a date.
 */
export function dayFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A!' };
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) return date;

  return { t: 'num', v: date.getDate() };
}

/**
 * `iferrorFunc` is the implementation of the IFERROR function.
 * IFERROR(value, value_if_error) — returns value_if_error if value is an error.
 */
export function iferrorFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const value = visit(exprs[0]);
  if (value.t === 'err') {
    return visit(exprs[1]);
  }

  return value;
}
