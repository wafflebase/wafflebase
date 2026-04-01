import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode } from './formula';
import { NumberArgs, BoolArgs } from './arguments';
import { Grid } from '../model/core/types';
import {
  toStr,
} from './functions-helpers';

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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length % 2 !== 0) {
    return { t: 'err', v: '#N/A' };
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

  return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 3) {
    return { t: 'err', v: '#N/A' };
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

  return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#N/A' };
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return { t: 'err', v: '#N/A' };
  }

  const value = BoolArgs.map(visit(exprs[0]), grid);
  if (value.t === 'err') {
    return value;
  }

  return { t: 'bool', v: !value.v };
}

/**
 * XOR(logical1, [logical2], ...) — returns TRUE if an odd number of arguments are TRUE.
 */
export function xorFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  let trueCount = 0;
  for (const node of BoolArgs.iterate(args, visit, grid)) {
    if (node.t === 'err') {
      return node;
    }
    if (node.v) {
      trueCount++;
    }
  }

  return { t: 'bool', v: trueCount % 2 === 1 };
}

/**
 * CHOOSE(index, value1, [value2], ...) — returns a value from a list based on index.
 */
export function chooseFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length < 2) {
    return { t: 'err', v: '#N/A' };
  }

  const indexNode = NumberArgs.map(visit(exprs[0]), grid);
  if (indexNode.t === 'err') {
    return indexNode;
  }

  const index = Math.trunc(indexNode.v);
  if (index < 1 || index >= exprs.length) {
    return { t: 'err', v: '#VALUE!' };
  }

  return visit(exprs[index]);
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
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A' };
  }

  const value = visit(exprs[0]);
  if (value.t === 'err') {
    return visit(exprs[1]);
  }

  return value;
}

/**
 * `ifnaFunc` is the implementation of the IFNA function.
 * IFNA(value, value_if_na) — returns fallback only when value is #N/A.
 */
export function ifnaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return { t: 'err', v: '#N/A' };
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return { t: 'err', v: '#N/A' };
  }

  const value = visit(exprs[0]);
  if (value.t === 'err' && value.v === '#N/A') {
    return visit(exprs[1]);
  }

  return value;
}

/**
 * TRUE() — returns the boolean value TRUE.
 */
export function trueFunc(): EvalNode {
  return { t: 'bool', v: true };
}

/**
 * FALSE() — returns the boolean value FALSE.
 */
export function falseFunc(): EvalNode {
  return { t: 'bool', v: false };
}

export const logicalEntries: [string, (...args: any[]) => EvalNode][] = [
  ['IF', ifFunc],
  ['IFS', ifsFunc],
  ['SWITCH', switchFunc],
  ['AND', andFunc],
  ['OR', orFunc],
  ['NOT', notFunc],
  ['XOR', xorFunc],
  ['CHOOSE', chooseFunc],
  ['IFERROR', iferrorFunc],
  ['IFNA', ifnaFunc],
  ['TRUE', trueFunc],
  ['FALSE', falseFunc],
];
