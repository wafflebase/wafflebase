import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';

/**
 * FunctionMap is a map of function name to the function implementation.
 */
export const FunctionMap = new Map([['SUM', sumFunction]]);

/**
 * `sumFunction` is the implementation of the SUM function.
 */
export function sumFunction(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => number,
): number {
  let sum = 0;
  if (ctx.args()) {
    const args = ctx.args()!;
    for (let i = 0; i < args.expr().length; i++) {
      sum += visit(args.expr(i));
    }
  }
  return sum;
}
