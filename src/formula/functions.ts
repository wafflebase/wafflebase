import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode } from './formula';
import { NumberArgs } from './arguments';
import { Sheet } from '../sheet/sheet';

/**
 * FunctionMap is a map of function name to the function implementation.
 */
export const FunctionMap = new Map([['SUM', sum]]);

/**
 * `sum` is the implementation of the SUM function.
 */
export function sum(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  sheet?: Sheet,
): EvalNode {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'err', v: '#N/A!' };
  }

  let value = 0;
  for (const node of NumberArgs.iterate(args, visit, sheet)) {
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
