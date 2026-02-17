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
  ['ABS', absFunc],
  ['ROUND', roundFunc],
  ['ROUNDUP', roundUpFunc],
  ['ROUNDDOWN', roundDownFunc],
  ['INT', intFunc],
  ['MOD', modFunc],
  ['SQRT', sqrtFunc],
  ['POWER', powerFunc],
  ['IF', ifFunc],
  ['IFS', ifsFunc],
  ['SWITCH', switchFunc],
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
  ['FIND', findFunc],
  ['SEARCH', searchFunc],
  ['TEXTJOIN', textjoinFunc],
  ['LOWER', lowerFunc],
  ['UPPER', upperFunc],
  ['PROPER', properFunc],
  ['SUBSTITUTE', substituteFunc],
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
 * `absFunc` is the implementation of the ABS function.
 * ABS(number) — returns the absolute value of a number.
 */
export function absFunc(
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

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.abs(num.v) };
}

function roundHalfAwayFromZero(value: number): number {
  if (value >= 0) {
    return Math.floor(value + 0.5);
  }

  return Math.ceil(value - 0.5);
}

function parsePlaces(
  expr: ParseTree | undefined,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { t: 'num'; v: number } | { t: 'err'; v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!' } {
  if (!expr) {
    return { t: 'num', v: 0 };
  }

  const places = NumberArgs.map(visit(expr), grid);
  if (places.t === 'err') {
    return places;
  }

  return { t: 'num', v: Math.trunc(places.v) };
}

/**
 * `roundFunc` is the implementation of the ROUND function.
 * ROUND(value, [places]) — rounds to a specified number of digits.
 */
export function roundFunc(
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

  const value = NumberArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }

  const places = parsePlaces(exprs[1], visit, grid);
  if (places.t === 'err') {
    return places;
  }

  const factor = 10 ** places.v;
  const rounded = roundHalfAwayFromZero(value.v * factor) / factor;
  return { t: 'num', v: rounded };
}

/**
 * `roundUpFunc` is the implementation of the ROUNDUP function.
 * ROUNDUP(value, [places]) — rounds away from zero.
 */
export function roundUpFunc(
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

  const value = NumberArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }

  const places = parsePlaces(exprs[1], visit, grid);
  if (places.t === 'err') {
    return places;
  }

  const factor = 10 ** places.v;
  const scaled = value.v * factor;
  const rounded = (scaled >= 0 ? Math.ceil(scaled) : Math.floor(scaled)) / factor;
  return { t: 'num', v: rounded };
}

/**
 * `roundDownFunc` is the implementation of the ROUNDDOWN function.
 * ROUNDDOWN(value, [places]) — rounds toward zero.
 */
export function roundDownFunc(
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

  const value = NumberArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }

  const places = parsePlaces(exprs[1], visit, grid);
  if (places.t === 'err') {
    return places;
  }

  const factor = 10 ** places.v;
  const scaled = value.v * factor;
  const rounded = (scaled >= 0 ? Math.floor(scaled) : Math.ceil(scaled)) / factor;
  return { t: 'num', v: rounded };
}

/**
 * `intFunc` is the implementation of the INT function.
 * INT(value) — rounds down to the nearest integer.
 */
export function intFunc(
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

  const value = NumberArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }

  return { t: 'num', v: Math.floor(value.v) };
}

/**
 * `modFunc` is the implementation of the MOD function.
 * MOD(dividend, divisor) — returns the remainder after division.
 */
export function modFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const dividend = NumberArgs.map(visit(exprs[0]), grid);
  if (dividend.t === 'err') {
    return dividend;
  }

  const divisor = NumberArgs.map(visit(exprs[1]), grid);
  if (divisor.t === 'err') {
    return divisor;
  }
  if (divisor.v === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  const remainder = dividend.v - divisor.v * Math.floor(dividend.v / divisor.v);
  return { t: 'num', v: remainder };
}

/**
 * `sqrtFunc` is the implementation of the SQRT function.
 * SQRT(value) — returns the positive square root.
 */
export function sqrtFunc(
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

  const value = NumberArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }
  if (value.v < 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.sqrt(value.v) };
}

/**
 * `powerFunc` is the implementation of the POWER function.
 * POWER(base, exponent) — returns base raised to exponent.
 */
export function powerFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A!' };
  }

  const base = NumberArgs.map(visit(exprs[0]), grid);
  if (base.t === 'err') {
    return base;
  }

  const exponent = NumberArgs.map(visit(exprs[1]), grid);
  if (exponent.t === 'err') {
    return exponent;
  }

  const result = Math.pow(base.v, exponent.v);
  if (!isFinite(result)) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: result };
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
 * `ifsFunc` is the implementation of the IFS function.
 * IFS(condition1, value1, [condition2, value2], ...) — returns the first value
 * whose condition is true.
 */
export function ifsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length % 2 !== 0) {
    return { t: 'err', v: '#N/A!' };
  }

  for (let i = 0; i < exprs.length; i += 2) {
    const condition = BoolArgs.map(visit(exprs[i]), grid);
    if (condition.t === 'err') {
      return condition;
    }

    if (condition.v) {
      return visit(exprs[i + 1]);
    }
  }

  return { t: 'err', v: '#N/A!' };
}

/**
 * `switchFunc` is the implementation of the SWITCH function.
 * SWITCH(expression, case1, value1, [case2, value2], [default])
 */
export function switchFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const expression = toStr(visit(exprs[0]), grid);
  if (expression.t === 'err') {
    return expression;
  }

  const remaining = exprs.length - 1;
  const hasDefault = remaining % 2 === 1;
  const pairCount = hasDefault ? (remaining - 1) / 2 : remaining / 2;

  for (let i = 0; i < pairCount; i++) {
    const caseValue = toStr(visit(exprs[1 + i * 2]), grid);
    if (caseValue.t === 'err') {
      return caseValue;
    }

    if (caseValue.v === expression.v) {
      return visit(exprs[2 + i * 2]);
    }
  }

  if (hasDefault) {
    return visit(exprs[exprs.length - 1]);
  }

  return { t: 'err', v: '#N/A!' };
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

function parseStartPosition(
  expr: ParseTree | undefined,
  text: string,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { t: 'num'; v: number } | { t: 'err'; v: '#VALUE!' | '#REF!' | '#N/A!' | '#ERROR!' } {
  if (!expr) {
    return { t: 'num', v: 1 };
  }

  const start = NumberArgs.map(visit(expr), grid);
  if (start.t === 'err') {
    return start;
  }

  const value = Math.trunc(start.v);
  if (value < 1 || value > text.length + 1) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: value };
}

/**
 * `findFunc` is the implementation of the FIND function.
 * FIND(search_for, text_to_search, [starting_at]) — case-sensitive search.
 */
export function findFunc(
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

  const searchFor = toStr(visit(exprs[0]), grid);
  if (searchFor.t === 'err') {
    return searchFor;
  }

  const text = toStr(visit(exprs[1]), grid);
  if (text.t === 'err') {
    return text;
  }

  const start = parseStartPosition(exprs[2], text.v, visit, grid);
  if (start.t === 'err') {
    return start;
  }

  if (searchFor.v === '') {
    return { t: 'num', v: start.v };
  }

  const index = text.v.indexOf(searchFor.v, start.v - 1);
  if (index < 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: index + 1 };
}

function wildcardToRegex(pattern: string): string {
  let regex = '';

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];

    if (ch === '~' && i + 1 < pattern.length) {
      regex += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
      continue;
    }

    if (ch === '*') {
      regex += '.*';
      continue;
    }

    if (ch === '?') {
      regex += '.';
      continue;
    }

    regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return regex;
}

/**
 * `searchFunc` is the implementation of the SEARCH function.
 * SEARCH(search_for, text_to_search, [starting_at]) — case-insensitive search.
 */
export function searchFunc(
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

  const searchFor = toStr(visit(exprs[0]), grid);
  if (searchFor.t === 'err') {
    return searchFor;
  }

  const text = toStr(visit(exprs[1]), grid);
  if (text.t === 'err') {
    return text;
  }

  const start = parseStartPosition(exprs[2], text.v, visit, grid);
  if (start.t === 'err') {
    return start;
  }

  if (searchFor.v === '') {
    return { t: 'num', v: start.v };
  }

  const query = wildcardToRegex(searchFor.v);
  const regex = new RegExp(query, 'i');
  const sliced = text.v.slice(start.v - 1);
  const match = regex.exec(sliced);
  if (!match || match.index === undefined) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: start.v + match.index };
}

/**
 * `textjoinFunc` is the implementation of the TEXTJOIN function.
 * TEXTJOIN(delimiter, ignore_empty, text1, [text2], ...)
 */
export function textjoinFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3) {
    return { t: 'err', v: '#N/A!' };
  }

  const delimiter = toStr(visit(exprs[0]), grid);
  if (delimiter.t === 'err') {
    return delimiter;
  }

  const ignoreEmpty = BoolArgs.map(visit(exprs[1]), grid);
  if (ignoreEmpty.t === 'err') {
    return ignoreEmpty;
  }

  const values: string[] = [];
  for (const expr of exprs.slice(2)) {
    const node = visit(expr);

    if (node.t === 'ref' && grid && isSrng(node.v)) {
      for (const ref of toSrefs([node.v])) {
        const value = toStr({ t: 'ref', v: ref }, grid);
        if (value.t === 'err') {
          return value;
        }
        if (ignoreEmpty.v && value.v === '') {
          continue;
        }
        values.push(value.v);
      }
      continue;
    }

    const value = toStr(node, grid);
    if (value.t === 'err') {
      return value;
    }
    if (ignoreEmpty.v && value.v === '') {
      continue;
    }
    values.push(value.v);
  }

  return { t: 'str', v: values.join(delimiter.v) };
}

/**
 * `lowerFunc` is the implementation of the LOWER function.
 * LOWER(text) — converts text to lowercase.
 */
export function lowerFunc(
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
  if (str.t === 'err') {
    return str;
  }

  return { t: 'str', v: str.v.toLowerCase() };
}

/**
 * `upperFunc` is the implementation of the UPPER function.
 * UPPER(text) — converts text to uppercase.
 */
export function upperFunc(
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
  if (str.t === 'err') {
    return str;
  }

  return { t: 'str', v: str.v.toUpperCase() };
}

/**
 * `properFunc` is the implementation of the PROPER function.
 * PROPER(text) — capitalizes words in text.
 */
export function properFunc(
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
  if (str.t === 'err') {
    return str;
  }

  const normalized = str.v.toLowerCase().replace(
    /\b([a-z])([a-z]*)/g,
    (_match, first: string, rest: string) => first.toUpperCase() + rest,
  );
  return { t: 'str', v: normalized };
}

/**
 * `substituteFunc` is the implementation of the SUBSTITUTE function.
 * SUBSTITUTE(text, search_for, replace_with, [occurrence]) — replaces text.
 */
export function substituteFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) {
    return { t: 'err', v: '#N/A!' };
  }

  const text = toStr(visit(exprs[0]), grid);
  if (text.t === 'err') {
    return text;
  }

  const searchFor = toStr(visit(exprs[1]), grid);
  if (searchFor.t === 'err') {
    return searchFor;
  }

  const replaceWith = toStr(visit(exprs[2]), grid);
  if (replaceWith.t === 'err') {
    return replaceWith;
  }

  if (searchFor.v === '') {
    return { t: 'str', v: text.v };
  }

  if (exprs.length === 3) {
    return { t: 'str', v: text.v.split(searchFor.v).join(replaceWith.v) };
  }

  const occurrence = NumberArgs.map(visit(exprs[3]), grid);
  if (occurrence.t === 'err') {
    return occurrence;
  }

  const target = Math.trunc(occurrence.v);
  if (target <= 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  let from = 0;
  let count = 0;
  while (true) {
    const index = text.v.indexOf(searchFor.v, from);
    if (index < 0) {
      return { t: 'str', v: text.v };
    }

    count++;
    if (count === target) {
      const replaced =
        text.v.slice(0, index) +
        replaceWith.v +
        text.v.slice(index + searchFor.v.length);
      return { t: 'str', v: replaced };
    }

    from = index + searchFor.v.length;
  }
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
