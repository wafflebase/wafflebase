import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode, ErrNode } from './formula';
import { NumberArgs } from './arguments';
import { Grid } from '../model/core/types';
import {
  isSrng,
  parseRange,
  toSref,
  toSrefs,
} from '../model/core/coordinates';
import {
  toStr,
  getRefsFromExpression,
  getReferenceMatrixFromExpression,
} from './functions-helpers';
import { gammaLanczos } from './functions-statistical';

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
    return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.abs(num.v) };
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#DIV/0!' };
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const value = NumberArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }
  if (value.v < 0) {
    return { t: 'err', v: '#NUM!' };
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#NUM!' };
  }

  return { t: 'num', v: result };
}

/**
 * `productFunc` is the implementation of the PRODUCT function.
 * PRODUCT(number1, [number2], ...) — multiplies numeric values.
 */
export function productFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  let value = 1;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    value *= node.v;
  }

  return { t: 'num', v: value };
}

/**
 * PI() — returns the value of π.
 */
export function piFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return { t: 'err', v: '#N/A' };
  }

  return { t: 'num', v: Math.PI };
}

/**
 * SIGN(number) — returns -1, 0, or 1 indicating the sign of a number.
 */
export function signFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.sign(num.v) };
}

/**
 * EVEN(number) — rounds a number up to the nearest even integer.
 */
export function evenFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  const v = num.v;
  if (v === 0) {
    return { t: 'num', v: 0 };
  }

  const rounded = v > 0 ? Math.ceil(v) : Math.floor(v);
  const result = rounded % 2 === 0 ? rounded : (v > 0 ? rounded + 1 : rounded - 1);
  return { t: 'num', v: result };
}

/**
 * ODD(number) — rounds a number up to the nearest odd integer.
 */
export function oddFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  const v = num.v;
  if (v === 0) {
    return { t: 'num', v: 1 };
  }

  const rounded = v > 0 ? Math.ceil(v) : Math.floor(v);
  const absRounded = Math.abs(rounded);
  const result = absRounded % 2 === 1 ? rounded : (v > 0 ? rounded + 1 : rounded - 1);
  return { t: 'num', v: result };
}

/**
 * EXP(number) — returns e raised to the power of a number.
 */
export function expFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.exp(num.v) };
}

/**
 * LN(number) — returns the natural logarithm of a number.
 */
export function lnFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }
  if (num.v <= 0) {
    return { t: 'err', v: '#NUM!' };
  }

  return { t: 'num', v: Math.log(num.v) };
}

/**
 * LOG(number, [base]) — returns the logarithm of a number to the given base (default 10).
 */
export function logFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }
  if (num.v <= 0) {
    return { t: 'err', v: '#NUM!' };
  }

  let base = 10;
  if (exprs.length === 2) {
    const baseNode = NumberArgs.map(visit(exprs[1]), grid);
    if (baseNode.t === 'err') {
      return baseNode;
    }
    if (baseNode.v <= 0) {
      return { t: 'err', v: '#NUM!' };
    }
    if (baseNode.v === 1) {
      return { t: 'err', v: '#DIV/0!' };
    }
    base = baseNode.v;
  }

  return { t: 'num', v: Math.log(num.v) / Math.log(base) };
}

/**
 * SIN(angle) — returns the sine of an angle (in radians).
 */
export function sinFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.sin(num.v) };
}

/**
 * COS(angle) — returns the cosine of an angle (in radians).
 */
export function cosFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.cos(num.v) };
}

/**
 * TAN(angle) — returns the tangent of an angle (in radians).
 */
export function tanFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.tan(num.v) };
}

/**
 * ASIN(value) — returns the arcsine in radians.
 */
export function asinFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }
  if (num.v < -1 || num.v > 1) {
    return { t: 'err', v: '#NUM!' };
  }

  return { t: 'num', v: Math.asin(num.v) };
}

/**
 * ACOS(value) — returns the arccosine in radians.
 */
export function acosFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }
  if (num.v < -1 || num.v > 1) {
    return { t: 'err', v: '#NUM!' };
  }

  return { t: 'num', v: Math.acos(num.v) };
}

/**
 * ATAN(value) — returns the arctangent in radians.
 */
export function atanFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: Math.atan(num.v) };
}

/**
 * ATAN2(x, y) — returns the angle in radians between the x-axis and a line from the origin to (x, y).
 */
export function atan2Func(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A' };
  }

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') {
    return x;
  }

  const y = NumberArgs.map(visit(exprs[1]), grid);
  if (y.t === 'err') {
    return y;
  }

  if (x.v === 0 && y.v === 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.atan2(y.v, x.v) };
}

/**
 * DEGREES(angle) — converts radians to degrees.
 */
export function degreesFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: (num.v * 180) / Math.PI };
}

/**
 * RADIANS(angle) — converts degrees to radians.
 */
export function radiansFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  return { t: 'num', v: (num.v * Math.PI) / 180 };
}

/**
 * CEILING(number, [significance]) — rounds a number up to the nearest multiple of significance.
 */
export function ceilingFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  let significance = 1;
  if (exprs.length === 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') {
      return sigNode;
    }
    significance = sigNode.v;
  }

  if (significance === 0) {
    return { t: 'num', v: 0 };
  }

  if (num.v > 0 && significance < 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.ceil(num.v / significance) * significance };
}

/**
 * FLOOR(number, [significance]) — rounds a number down to the nearest multiple of significance.
 */
export function floorFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  let significance = 1;
  if (exprs.length === 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') {
      return sigNode;
    }
    significance = sigNode.v;
  }

  if (significance === 0) {
    return { t: 'num', v: 0 };
  }

  if (num.v > 0 && significance < 0) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.floor(num.v / significance) * significance };
}

/**
 * TRUNC(number, [places]) — truncates a number to a given number of decimal places.
 */
export function truncFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  let places = 0;
  if (exprs.length === 2) {
    const placesNode = NumberArgs.map(visit(exprs[1]), grid);
    if (placesNode.t === 'err') {
      return placesNode;
    }
    places = Math.trunc(placesNode.v);
  }

  const factor = Math.pow(10, places);
  return { t: 'num', v: Math.trunc(num.v * factor) / factor };
}

/**
 * MROUND(number, multiple) — rounds a number to the nearest specified multiple.
 */
export function mroundFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  const multiple = NumberArgs.map(visit(exprs[1]), grid);
  if (multiple.t === 'err') {
    return multiple;
  }

  if (multiple.v === 0) {
    return { t: 'num', v: 0 };
  }

  if ((num.v > 0 && multiple.v < 0) || (num.v < 0 && multiple.v > 0)) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.round(num.v / multiple.v) * multiple.v };
}

/**
 * CEILING.MATH(number, [significance], [mode]) — rounds up to nearest multiple.
 * If mode is non-zero and number is negative, rounds away from zero.
 */
export function ceilingmathFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) return { t: 'err', v: '#N/A' };

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;

  let significance = 1;
  if (exprs.length >= 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') return sigNode;
    significance = sigNode.v;
  }
  if (significance === 0) return { t: 'num', v: 0 };

  let mode = 0;
  if (exprs.length === 3) {
    const modeNode = NumberArgs.map(visit(exprs[2]), grid);
    if (modeNode.t === 'err') return modeNode;
    mode = modeNode.v;
  }

  significance = Math.abs(significance);
  if (num.v < 0 && mode !== 0) {
    // Round away from zero (more negative)
    return { t: 'num', v: -Math.ceil(Math.abs(num.v) / significance) * significance };
  }
  return { t: 'num', v: Math.ceil(num.v / significance) * significance };
}

/**
 * FLOOR.MATH(number, [significance], [mode]) — rounds down to nearest multiple.
 * If mode is non-zero and number is negative, rounds toward zero.
 */
export function floormathFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 3) return { t: 'err', v: '#N/A' };

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;

  let significance = 1;
  if (exprs.length >= 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') return sigNode;
    significance = sigNode.v;
  }
  if (significance === 0) return { t: 'num', v: 0 };

  let mode = 0;
  if (exprs.length === 3) {
    const modeNode = NumberArgs.map(visit(exprs[2]), grid);
    if (modeNode.t === 'err') return modeNode;
    mode = modeNode.v;
  }

  significance = Math.abs(significance);
  if (num.v < 0 && mode !== 0) {
    // Round toward zero (less negative)
    return { t: 'num', v: -Math.floor(Math.abs(num.v) / significance) * significance };
  }
  return { t: 'num', v: Math.floor(num.v / significance) * significance };
}

/**
 * CEILING.PRECISE(number, [significance]) — always rounds up in magnitude.
 */
export function ceilingpreciseFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;

  let significance = 1;
  if (exprs.length === 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') return sigNode;
    significance = Math.abs(sigNode.v);
  }
  if (significance === 0) return { t: 'num', v: 0 };

  return { t: 'num', v: Math.ceil(num.v / significance) * significance };
}

/**
 * FLOOR.PRECISE(number, [significance]) — always rounds down in magnitude.
 */
export function floorpreciseFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;

  let significance = 1;
  if (exprs.length === 2) {
    const sigNode = NumberArgs.map(visit(exprs[1]), grid);
    if (sigNode.t === 'err') return sigNode;
    significance = Math.abs(sigNode.v);
  }
  if (significance === 0) return { t: 'num', v: 0 };

  return { t: 'num', v: Math.floor(num.v / significance) * significance };
}

/**
 * ISO.CEILING(number, [significance]) — rounds up to nearest multiple,
 * always rounding away from zero regardless of sign.
 */
export function isoceilingFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };

  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;

  let sig = 1;
  if (exprs.length >= 2) {
    const s = NumberArgs.map(visit(exprs[1]), grid);
    if (s.t === 'err') return s;
    sig = Math.abs(s.v);
  }
  if (sig === 0) return { t: 'num', v: 0 };

  return { t: 'num', v: Math.ceil(n.v / sig) * sig };
}

/**
 * GCD(number1, [number2], ...) — returns the greatest common divisor.
 */
export function gcdFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  let result = 0;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    const val = Math.trunc(node.v);
    if (val < 0) {
      return { t: 'err', v: '#VALUE!' };
    }
    result = gcdTwo(result, val);
  }

  return { t: 'num', v: result };
}

/**
 * LCM(number1, [number2], ...) — returns the least common multiple.
 */
export function lcmFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  let result = 1;
  let hasValue = false;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    const val = Math.trunc(node.v);
    if (val < 0) {
      return { t: 'err', v: '#VALUE!' };
    }
    if (val === 0) {
      return { t: 'num', v: 0 };
    }
    result = (result / gcdTwo(result, val)) * val;
    hasValue = true;
  }

  if (!hasValue) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: result };
}

/**
 * COMBIN(n, k) — returns the number of combinations.
 */
export function combinFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A' };
  }

  const nNode = NumberArgs.map(visit(exprs[0]), grid);
  if (nNode.t === 'err') {
    return nNode;
  }

  const kNode = NumberArgs.map(visit(exprs[1]), grid);
  if (kNode.t === 'err') {
    return kNode;
  }

  const n = Math.trunc(nNode.v);
  const k = Math.trunc(kNode.v);
  if (n < 0 || k < 0 || k > n) {
    return { t: 'err', v: '#NUM!' };
  }

  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }

  return { t: 'num', v: Math.round(result) };
}

/**
 * COMBINA(n, k) — number of combinations with repetition.
 * COMBINA(n, k) = C(n+k-1, k) = (n+k-1)! / (k! * (n-1)!)
 */
export function combinaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  const k = NumberArgs.map(visit(exprs[1]), grid);
  if (k.t === 'err') return k;
  const ni = Math.trunc(n.v);
  const ki = Math.trunc(k.v);
  if (ni < 0 || ki < 0) return { t: 'err', v: '#NUM!' };
  if (ki === 0) return { t: 'num', v: 1 };
  // C(ni+ki-1, ki)
  let result = 1;
  for (let i = 0; i < ki; i++) {
    result = result * (ni + ki - 1 - i) / (i + 1);
  }
  return { t: 'num', v: Math.round(result) };
}

/**
 * FACT(number) — returns the factorial of a number.
 */
export function factFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') {
    return num;
  }

  const n = Math.trunc(num.v);
  if (n < 0) {
    return { t: 'err', v: '#NUM!' };
  }

  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return { t: 'num', v: result };
}

/**
 * FACTDOUBLE(number) — returns the double factorial of a number.
 */
export function factdoubleFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  const n = Math.trunc(num.v);
  if (n < -1) return { t: 'err', v: '#NUM!' };
  if (n <= 0) return { t: 'num', v: 1 };
  let result = 1;
  for (let i = n; i > 0; i -= 2) {
    result *= i;
  }
  return { t: 'num', v: result };
}

/**
 * QUOTIENT(numerator, denominator) — returns the integer portion of a division.
 */
export function quotientFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A' };
  }

  const numerator = NumberArgs.map(visit(exprs[0]), grid);
  if (numerator.t === 'err') {
    return numerator;
  }

  const denominator = NumberArgs.map(visit(exprs[1]), grid);
  if (denominator.t === 'err') {
    return denominator;
  }

  if (denominator.v === 0) {
    return { t: 'err', v: '#DIV/0!' };
  }

  return { t: 'num', v: Math.trunc(numerator.v / denominator.v) };
}

/**
 * BASE(number, base, [min_length]) — converts a number to text in another base.
 */
export function baseFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  const base = NumberArgs.map(visit(exprs[1]), grid);
  if (base.t === 'err') return base;
  const b = Math.trunc(base.v);
  if (b < 2 || b > 36) return { t: 'err', v: '#NUM!' };
  let result = Math.trunc(num.v).toString(b).toUpperCase();
  if (exprs.length === 3) {
    const minLen = NumberArgs.map(visit(exprs[2]), grid);
    if (minLen.t === 'err') return minLen;
    result = result.padStart(Math.trunc(minLen.v), '0');
  }
  return { t: 'str', v: result };
}

/**
 * DECIMAL(text, base) — converts text from another base to a decimal number.
 */
export function decimalFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const str = toStr(visit(exprs[0]), grid);
  if (str.t === 'err') return str;
  const base = NumberArgs.map(visit(exprs[1]), grid);
  if (base.t === 'err') return base;
  const b = Math.trunc(base.v);
  if (b < 2 || b > 36) return { t: 'err', v: '#NUM!' };
  const num = parseInt(str.v, b);
  if (isNaN(num)) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: num };
}

/**
 * SQRTPI(number) — returns the square root of (number * PI).
 */
export function sqrtpiFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  if (num.v < 0) return { t: 'err', v: '#NUM!' };
  return { t: 'num', v: Math.sqrt(num.v * Math.PI) };
}

/**
 * SINH(number) — returns the hyperbolic sine.
 */
export function sinhFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'num', v: Math.sinh(num.v) };
}

/**
 * COSH(number) — returns the hyperbolic cosine.
 */
export function coshFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'num', v: Math.cosh(num.v) };
}

/**
 * TANH(number) — returns the hyperbolic tangent.
 */
export function tanhFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'num', v: Math.tanh(num.v) };
}

/**
 * ASINH(number) — returns the inverse hyperbolic sine.
 */
export function asinhFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  return { t: 'num', v: Math.asinh(num.v) };
}

/**
 * ACOSH(number) — returns the inverse hyperbolic cosine.
 */
export function acoshFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  if (num.v < 1) return { t: 'err', v: '#NUM!' };
  return { t: 'num', v: Math.acosh(num.v) };
}

/**
 * ATANH(number) — returns the inverse hyperbolic tangent.
 */
export function atanhFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  if (num.v <= -1 || num.v >= 1) return { t: 'err', v: '#NUM!' };
  return { t: 'num', v: Math.atanh(num.v) };
}

/**
 * COT(angle) — returns the cotangent of an angle in radians.
 */
export function cotFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  const tan = Math.tan(num.v);
  if (tan === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: 1 / tan };
}

/**
 * CSC(angle) — returns the cosecant of an angle in radians.
 */
export function cscFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  const sin = Math.sin(num.v);
  if (sin === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: 1 / sin };
}

/**
 * SEC(angle) — returns the secant of an angle in radians.
 */
export function secFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  const cos = Math.cos(num.v);
  if (cos === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: 1 / cos };
}

/**
 * SECH(number) — hyperbolic secant.
 */
export function sechFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  return { t: 'num', v: 1 / Math.cosh(n.v) };
}

/**
 * CSCH(number) — hyperbolic cosecant.
 */
export function cschFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  if (n.v === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: 1 / Math.sinh(n.v) };
}

/**
 * COTH(number) — hyperbolic cotangent.
 */
export function cothFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  if (n.v === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: Math.cosh(n.v) / Math.sinh(n.v) };
}

/**
 * ACOT(number) — arccotangent (inverse cotangent).
 */
export function acotFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  return { t: 'num', v: Math.atan(1 / n.v) };
}

/**
 * ACOTH(number) — inverse hyperbolic cotangent.
 */
export function acothFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  if (Math.abs(n.v) <= 1) return { t: 'err', v: '#NUM!' };
  return { t: 'num', v: 0.5 * Math.log((n.v + 1) / (n.v - 1)) };
}

/**
 * MULTINOMIAL(n1, n2, ...) — returns the multinomial coefficient.
 */
export function multinomialFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };

  let sum = 0;
  let denomProduct = 1;
  for (const expr of args.expr()) {
    const n = NumberArgs.map(visit(expr), grid);
    if (n.t === 'err') return n;
    const val = Math.trunc(n.v);
    if (val < 0) return { t: 'err', v: '#NUM!' };
    sum += val;
    denomProduct *= gammaLanczos(val + 1);
  }
  return { t: 'num', v: Math.round(gammaLanczos(sum + 1) / denomProduct) };
}

/**
 * SERIESSUM(x, n, m, coefficients) — returns the sum of a power series.
 */
export function seriessumFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const n = NumberArgs.map(visit(exprs[1]), grid);
  if (n.t === 'err') return n;
  const m = NumberArgs.map(visit(exprs[2]), grid);
  if (m.t === 'err') return m;

  // Get coefficients from range
  const coeffsResult = getRefsFromExpression(exprs[3], visit, grid);
  if (coeffsResult.t === 'err') return coeffsResult;

  let sum = 0;
  for (let i = 0; i < coeffsResult.v.length; i++) {
    const cell = grid!.get(coeffsResult.v[i]);
    const coeff = cell ? Number(cell.v) : 0;
    if (isNaN(coeff)) return { t: 'err', v: '#VALUE!' };
    sum += coeff * Math.pow(x.v, n.v + i * m.v);
  }
  return { t: 'num', v: sum };
}

/**
 * SUMSQ(number1, [number2], ...) — returns the sum of the squares of the arguments.
 */
export function sumsqFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  let total = 0;
  for (const node of NumberArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    total += node.v ** 2;
  }

  return { t: 'num', v: total };
}

/**
 * SUMPRODUCT(array1, [array2], ...) — multiplies corresponding elements and returns the sum.
 */
export function sumproductFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 1) {
    return { t: 'err', v: '#N/A' };
  }

  const arrays: number[][] = [];
  for (const expr of exprs) {
    const refs = getRefsFromExpression(expr, visit, grid);
    if (refs.t === 'err') {
      return refs;
    }

    const values: number[] = [];
    for (const ref of refs.v) {
      const cellVal = grid?.get(ref)?.v || '';
      values.push(cellVal !== '' && !isNaN(Number(cellVal)) ? Number(cellVal) : 0);
    }
    arrays.push(values);
  }

  const length = arrays[0].length;
  if (arrays.some((a) => a.length !== length)) {
    return { t: 'err', v: '#VALUE!' };
  }

  let total = 0;
  for (let i = 0; i < length; i++) {
    let product = 1;
    for (const arr of arrays) {
      product *= arr[i];
    }
    total += product;
  }

  return { t: 'num', v: total };
}

/**
 * `randFunc` is the implementation of the RAND function.
 * RAND() — returns a random number in [0, 1).
 */
export function randFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return { t: 'err', v: '#N/A' };
  }

  return { t: 'num', v: Math.random() };
}

/**
 * `randbetweenFunc` is the implementation of the RANDBETWEEN function.
 * RANDBETWEEN(low, high) — returns a random integer in the inclusive range.
 */
export function randbetweenFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A' };
  }

  const lowNode = NumberArgs.map(visit(exprs[0]), grid);
  if (lowNode.t === 'err') {
    return lowNode;
  }

  const highNode = NumberArgs.map(visit(exprs[1]), grid);
  if (highNode.t === 'err') {
    return highNode;
  }

  const low = Math.ceil(lowNode.v);
  const high = Math.floor(highNode.v);
  if (low > high) {
    return { t: 'err', v: '#VALUE!' };
  }

  return { t: 'num', v: Math.floor(Math.random() * (high - low + 1)) + low };
}

/**
 * ARABIC(roman_numeral) — converts Roman numeral text to a number.
 */
export function arabicFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const node = visit(exprs[0]);
  const strResult = toStr(node, grid);
  if (strResult.t === 'err') return strResult;
  const text = strResult.v.toUpperCase();

  const romanValues: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let result = 0;
  for (let i = 0; i < text.length; i++) {
    const current = romanValues[text[i]];
    const next = i + 1 < text.length ? romanValues[text[i + 1]] : 0;
    if (current === undefined) return { t: 'err', v: '#VALUE!' };
    if (current < next) {
      result -= current;
    } else {
      result += current;
    }
  }
  return { t: 'num', v: result };
}

/**
 * ROMAN(number, [form]) — converts a number to Roman numeral text.
 */
export function romanFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };

  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  let num = Math.trunc(n.v);
  if (num < 0 || num > 3999) return { t: 'err', v: '#VALUE!' };
  if (num === 0) return { t: 'str', v: '' };

  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const symbols = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let result = '';
  for (let i = 0; i < values.length; i++) {
    while (num >= values[i]) {
      result += symbols[i];
      num -= values[i];
    }
  }
  return { t: 'str', v: result };
}

/**
 * PERMUT(n, k) — returns the number of permutations.
 */
export function permutFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const nNode = NumberArgs.map(visit(exprs[0]), grid);
  if (nNode.t === 'err') return nNode;
  const kNode = NumberArgs.map(visit(exprs[1]), grid);
  if (kNode.t === 'err') return kNode;
  const n = Math.trunc(nNode.v);
  const k = Math.trunc(kNode.v);
  if (n < 0 || k < 0 || k > n) return { t: 'err', v: '#VALUE!' };
  let result = 1;
  for (let i = n; i > n - k; i--) {
    result *= i;
  }
  return { t: 'num', v: result };
}

/**
 * PERMUTATIONA(n, k) — number of permutations with repetition = n^k.
 */
export function permutationaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  const k = NumberArgs.map(visit(exprs[1]), grid);
  if (k.t === 'err') return k;
  const ni = Math.trunc(n.v);
  const ki = Math.trunc(k.v);
  if (ni < 0 || ki < 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.pow(ni, ki) };
}

/**
 * SUBTOTAL(function_num, ref1, [ref2], ...) — applies an aggregate function.
 */
export function subtotalFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 2) return { t: 'err', v: '#N/A' };

  const fnNode = NumberArgs.map(visit(exprs[0]), grid);
  if (fnNode.t === 'err') return fnNode;
  const fn = Math.trunc(fnNode.v);

  const values: number[] = [];
  for (let i = 1; i < exprs.length; i++) {
    const node = visit(exprs[i]);
    if (node.t === 'err') return node;
    if (node.t === 'num') {
      values.push(node.v);
    } else if (node.t === 'ref' && grid) {
      for (const ref of toSrefs([node.v])) {
        const cellVal = grid.get(ref)?.v || '';
        if (cellVal !== '' && !isNaN(Number(cellVal))) {
          values.push(Number(cellVal));
        }
      }
    }
  }

  const fnNum = fn > 100 ? fn - 100 : fn;
  if (values.length === 0 && fnNum !== 2 && fnNum !== 3) return { t: 'num', v: 0 };

  switch (fnNum) {
    case 1: // AVERAGE
      return { t: 'num', v: values.reduce((a, b) => a + b, 0) / values.length };
    case 2: // COUNT
      return { t: 'num', v: values.length };
    case 3: // COUNTA
      return { t: 'num', v: values.length };
    case 4: // MAX
      return { t: 'num', v: Math.max(...values) };
    case 5: // MIN
      return { t: 'num', v: Math.min(...values) };
    case 6: // PRODUCT
      return { t: 'num', v: values.reduce((a, b) => a * b, 1) };
    case 7: { // STDEV
      const n = values.length;
      if (n < 2) return { t: 'err', v: '#DIV/0!' };
      const mean = values.reduce((a, b) => a + b, 0) / n;
      const variance = values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1);
      return { t: 'num', v: Math.sqrt(variance) };
    }
    case 8: { // STDEVP
      const n = values.length;
      if (n === 0) return { t: 'err', v: '#DIV/0!' };
      const mean = values.reduce((a, b) => a + b, 0) / n;
      const variance = values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n;
      return { t: 'num', v: Math.sqrt(variance) };
    }
    case 9: // SUM
      return { t: 'num', v: values.reduce((a, b) => a + b, 0) };
    case 10: { // VAR
      const n = values.length;
      if (n < 2) return { t: 'err', v: '#DIV/0!' };
      const mean = values.reduce((a, b) => a + b, 0) / n;
      return { t: 'num', v: values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1) };
    }
    case 11: { // VARP
      const n = values.length;
      if (n === 0) return { t: 'err', v: '#DIV/0!' };
      const mean = values.reduce((a, b) => a + b, 0) / n;
      return { t: 'num', v: values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n };
    }
    default:
      return { t: 'err', v: '#VALUE!' };
  }
}

/**
 * AGGREGATE(function_num, options, ref1, ...) — performs aggregate with error handling.
 * Simplified: function_num selects the aggregate function, ignores error values.
 */
export function aggregateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3) return { t: 'err', v: '#N/A' };
  const funcNum = NumberArgs.map(visit(exprs[0]), grid);
  if (funcNum.t === 'err') return funcNum;
  // Skip options (exprs[1])
  // Collect numeric values from remaining args, skipping errors
  const nums: number[] = [];
  for (let i = 2; i < exprs.length; i++) {
    const node = visit(exprs[i]);
    if (node.t === 'err') continue;
    if (node.t === 'ref' && grid) {
      for (const sref of toSrefs(Array.isArray(node.v) ? [node.v] : [node.v])) {
        const cell = grid.get(sref);
        if (cell && cell.v != null) {
          const n = Number(cell.v);
          if (!isNaN(n)) nums.push(n);
        }
      }
    } else {
      const n = NumberArgs.map(node, grid);
      if (n.t !== 'err') nums.push(n.v);
    }
  }
  const fn = Math.trunc(funcNum.v);
  switch (fn) {
    case 1: return { t: 'num', v: nums.reduce((a, b) => a + b, 0) / (nums.length || 1) }; // AVERAGE
    case 2: return { t: 'num', v: nums.length }; // COUNT
    case 3: return { t: 'num', v: nums.length }; // COUNTA
    case 4: return { t: 'num', v: nums.length > 0 ? Math.max(...nums) : 0 }; // MAX
    case 5: return { t: 'num', v: nums.length > 0 ? Math.min(...nums) : 0 }; // MIN
    case 6: return { t: 'num', v: nums.reduce((a, b) => a * b, 1) }; // PRODUCT
    case 7: { // STDEV.S
      if (nums.length < 2) return { t: 'err', v: '#VALUE!' };
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1);
      return { t: 'num', v: Math.sqrt(variance) };
    }
    case 8: { // STDEV.P
      if (nums.length === 0) return { t: 'err', v: '#VALUE!' };
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
      return { t: 'num', v: Math.sqrt(variance) };
    }
    case 9: return { t: 'num', v: nums.reduce((a, b) => a + b, 0) }; // SUM
    case 10: { // VAR.S
      if (nums.length < 2) return { t: 'err', v: '#VALUE!' };
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return { t: 'num', v: nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1) };
    }
    case 11: { // VAR.P
      if (nums.length === 0) return { t: 'err', v: '#VALUE!' };
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return { t: 'num', v: nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length };
    }
    case 12: { // MEDIAN
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return { t: 'num', v: sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid] };
    }
    default: return { t: 'err', v: '#VALUE!' };
  }
}

/**
 * MDETERM(square_matrix) — returns the determinant of a square matrix.
 */
export function mdetermFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };

  const node = visit(exprs[0]);
  if (node.t === 'err') return node;
  if (node.t === 'num') return node; // 1x1 matrix
  if (node.t !== 'ref' || !grid) return { t: 'err', v: '#VALUE!' };

  // Parse range to get dimensions
  const ref = node.v;
  if (!isSrng(ref)) {
    // Single cell = 1x1 matrix
    const cell = grid.get(ref);
    const v = cell?.v || '';
    if (v === '' || isNaN(Number(v))) return { t: 'err', v: '#VALUE!' };
    return { t: 'num', v: Number(v) };
  }

  const range = parseRange(ref);
  const rows = range[1].r - range[0].r + 1;
  const cols = range[1].c - range[0].c + 1;
  if (rows !== cols) return { t: 'err', v: '#VALUE!' };

  // Build matrix
  const matrix: number[][] = [];
  for (let r = range[0].r; r <= range[1].r; r++) {
    const row: number[] = [];
    for (let c = range[0].c; c <= range[1].c; c++) {
      const cellRef = toSref({ r, c });
      const cell = grid.get(cellRef);
      const v = cell?.v || '';
      if (v === '' || isNaN(Number(v))) return { t: 'err', v: '#VALUE!' };
      row.push(Number(v));
    }
    matrix.push(row);
  }

  // LU decomposition for determinant
  function det(m: number[][]): number {
    const n = m.length;
    if (n === 1) return m[0][0];
    if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
    let result = 0;
    for (let j = 0; j < n; j++) {
      const sub: number[][] = [];
      for (let i = 1; i < n; i++) {
        sub.push([...m[i].slice(0, j), ...m[i].slice(j + 1)]);
      }
      result += (j % 2 === 0 ? 1 : -1) * m[0][j] * det(sub);
    }
    return result;
  }

  return { t: 'num', v: det(matrix) };
}

/**
 * MMULT(array1, array2) — matrix multiplication of two ranges.
 * Returns flattened result as comma-separated string for single-cell output.
 */
export function mmultFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };

  const m1 = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m1 && m1.t === 'err') return m1;
  const m2 = getReferenceMatrixFromExpression(exprs[1], visit, grid);
  if ('t' in m2 && m2.t === 'err') return m2;
  if (m1.t !== 'matrix' || m2.t !== 'matrix') return { t: 'err', v: '#VALUE!' };

  const a = m1.v;
  const b = m2.v;
  // a.colCount must equal b.rowCount
  if (a.colCount !== b.rowCount) return { t: 'err', v: '#VALUE!' };

  const getVal = (refs: string[], row: number, col: number, cols: number): number => {
    const cellVal = grid?.get(refs[row * cols + col])?.v;
    return cellVal != null && cellVal !== '' ? Number(cellVal) : 0;
  };

  const resultRows = a.rowCount;
  const resultCols = b.colCount;
  const result: number[] = [];
  for (let i = 0; i < resultRows; i++) {
    for (let j = 0; j < resultCols; j++) {
      let sum = 0;
      for (let k = 0; k < a.colCount; k++) {
        sum += getVal(a.refs, i, k, a.colCount) * getVal(b.refs, k, j, b.colCount);
      }
      result.push(sum);
    }
  }
  // Return top-left value for single-cell evaluation
  return { t: 'num', v: result[0] };
}

/**
 * MINVERSE(array) — returns the inverse of a square matrix.
 * Returns the top-left element for single-cell evaluation.
 */
export function minverseFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };

  const m = getReferenceMatrixFromExpression(exprs[0], visit, grid);
  if ('t' in m && m.t === 'err') return m;
  if (m.t !== 'matrix') return { t: 'err', v: '#VALUE!' };

  const n = m.v.rowCount;
  if (n !== m.v.colCount) return { t: 'err', v: '#VALUE!' };

  // Build augmented matrix [A | I]
  const aug: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      const cellVal = grid?.get(m.v.refs[i * n + j])?.v;
      row.push(cellVal != null && cellVal !== '' ? Number(cellVal) : 0);
    }
    for (let j = 0; j < n; j++) {
      row.push(i === j ? 1 : 0);
    }
    aug.push(row);
  }

  // Gauss-Jordan elimination
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) return { t: 'err', v: '#VALUE!' }; // Singular
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }
    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) {
      aug[col][j] /= pivot;
    }
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Return top-left element of inverse
  return { t: 'num', v: aug[0][n] };
}

/**
 * MUNIT(dimension) — returns the identity matrix of size n×n.
 * Returns 1 (top-left element of identity matrix).
 */
export function munitFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  if (n.v < 1) return { t: 'err', v: '#VALUE!' };
  // Top-left element of identity matrix is always 1
  return { t: 'num', v: 1 };
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
): { t: 'num'; v: number } | ErrNode {
  if (!expr) {
    return { t: 'num', v: 0 };
  }

  const places = NumberArgs.map(visit(expr), grid);
  if (places.t === 'err') {
    return places;
  }

  return { t: 'num', v: Math.trunc(places.v) };
}

function gcdTwo(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * LOG10(number) — base-10 logarithm.
 */
export function log10Func(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;
  if (n.v <= 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.log10(n.v) };
}

export const mathEntries: [string, (...args: any[]) => EvalNode][] = [
  ['SUM', sum],
  ['ABS', absFunc],
  ['ROUND', roundFunc],
  ['ROUNDUP', roundUpFunc],
  ['ROUNDDOWN', roundDownFunc],
  ['INT', intFunc],
  ['MOD', modFunc],
  ['SQRT', sqrtFunc],
  ['POWER', powerFunc],
  ['PRODUCT', productFunc],
  ['PI', piFunc],
  ['SIGN', signFunc],
  ['EVEN', evenFunc],
  ['ODD', oddFunc],
  ['EXP', expFunc],
  ['LN', lnFunc],
  ['LOG', logFunc],
  ['SIN', sinFunc],
  ['COS', cosFunc],
  ['TAN', tanFunc],
  ['ASIN', asinFunc],
  ['ACOS', acosFunc],
  ['ATAN', atanFunc],
  ['ATAN2', atan2Func],
  ['DEGREES', degreesFunc],
  ['RADIANS', radiansFunc],
  ['CEILING', ceilingFunc],
  ['FLOOR', floorFunc],
  ['TRUNC', truncFunc],
  ['MROUND', mroundFunc],
  ['CEILING.MATH', ceilingmathFunc],
  ['FLOOR.MATH', floormathFunc],
  ['CEILING.PRECISE', ceilingpreciseFunc],
  ['FLOOR.PRECISE', floorpreciseFunc],
  ['ISO.CEILING', isoceilingFunc],
  ['GCD', gcdFunc],
  ['LCM', lcmFunc],
  ['COMBIN', combinFunc],
  ['COMBINA', combinaFunc],
  ['FACT', factFunc],
  ['FACTDOUBLE', factdoubleFunc],
  ['QUOTIENT', quotientFunc],
  ['BASE', baseFunc],
  ['DECIMAL', decimalFunc],
  ['SQRTPI', sqrtpiFunc],
  ['SINH', sinhFunc],
  ['COSH', coshFunc],
  ['TANH', tanhFunc],
  ['ASINH', asinhFunc],
  ['ACOSH', acoshFunc],
  ['ATANH', atanhFunc],
  ['COT', cotFunc],
  ['CSC', cscFunc],
  ['SEC', secFunc],
  ['SECH', sechFunc],
  ['CSCH', cschFunc],
  ['COTH', cothFunc],
  ['ACOT', acotFunc],
  ['ACOTH', acothFunc],
  ['MULTINOMIAL', multinomialFunc],
  ['SERIESSUM', seriessumFunc],
  ['SUMSQ', sumsqFunc],
  ['SUMPRODUCT', sumproductFunc],
  ['RAND', randFunc],
  ['RANDBETWEEN', randbetweenFunc],
  ['ARABIC', arabicFunc],
  ['ROMAN', romanFunc],
  ['PERMUT', permutFunc],
  ['PERMUTATIONA', permutationaFunc],
  ['SUBTOTAL', subtotalFunc],
  ['AGGREGATE', aggregateFunc],
  ['MDETERM', mdetermFunc],
  ['MMULT', mmultFunc],
  ['MINVERSE', minverseFunc],
  ['MUNIT', munitFunc],
];
