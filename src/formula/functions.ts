import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvaluationResult } from './formula';
import { NumberArgs } from './arguments';

/**
 * FunctionMap is a map of function name to the function implementation.
 */
export const FunctionMap = new Map([['SUM', sum]]);

/**
 * `sum` is the implementation of the SUM function.
 */
export function sum(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvaluationResult,
): EvaluationResult {
  const args = ctx.args()!;
  if (!args) {
    return { t: 'error', v: '#N/A' };
  }

  let value = 0;
  for (const expr of args.expr()) {
    value += NumberArgs.map(visit(expr)).v;
  }

  return {
    t: 'number',
    v: value,
  };
}
