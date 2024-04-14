import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';

/**
 * FunctionMap is a map of function name to the function implementation.
 */
export const FunctionMap = new Map([['SUM', sum]]);

/**
 * `sum` is the implementation of the SUM function.
 */
export function sum(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => number,
): number {
  // TODO(hackerwins): Sum should filter out non-numeric values.
  // TODO(hackerwins): Sum must accpet at least 1 argument.
  let sum = 0;
  if (ctx.args()) {
    const args = ctx.args()!;
    for (let i = 0; i < args.expr().length; i++) {
      sum += visit(args.expr(i));
    }
  }
  return sum;
}
