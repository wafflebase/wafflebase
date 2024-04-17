import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode } from './formula';
import { NumberArgs, ref2num } from './arguments';
import { Sheet } from '../sheet/sheet';
import { toRefs } from '../sheet/coordinates';

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
    return { t: 'err', v: '#N/A' };
  }

  let value = 0;
  for (const expr of args.expr()) {
    const node = visit(expr);
    // TODO(hackerwins): We need to hide toRefs and ref2num behind NumberArgs.
    // TODO(hackerwins): We need to clean up ref and cellID. There are too many type conversions.
    if (node.t === 'ref' && sheet) {
      for (const ref of toRefs(new Set([node.v]))) {
        value += ref2num({ t: 'ref', v: ref }, sheet).v;
      }
      continue;
    }
    value += NumberArgs.map(node, sheet).v;
  }

  return {
    t: 'num',
    v: value,
  };
}
