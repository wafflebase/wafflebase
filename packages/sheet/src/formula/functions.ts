import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode } from './formula';
import { NumberArgs, BoolArgs } from './arguments';
import { Grid } from '../model/types';

/**
 * FunctionMap is a map of function name to the function implementation.
 */
export const FunctionMap = new Map([
  ['SUM', sum],
  ['IF', ifFunc],
  ['AND', andFunc],
  ['OR', orFunc],
  ['NOT', notFunc],
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
