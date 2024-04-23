import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { ArgsContext } from '../../antlr/FormulaParser';
import { Sheet } from '../sheet/sheet';
import { EvalNode, BoolNode, NumNode, StrNode, RefNode } from './formula';
import { toRefs } from '../sheet/coordinates';

/**
 * Arguments is a helper to build arguments for a function.
 */
class Arguments<T extends EvalNode> {
  private ref?: (result: RefNode, sheet: Sheet) => T;
  private bool?: (result: BoolNode) => T;
  private num?: (result: NumNode) => T;
  private str?: (result: StrNode) => T;

  static create<T extends EvalNode>(): Arguments<T> {
    return new Arguments<T>();
  }

  /**
   * `setRef` sets the mapping function for the reference node.
   */
  setRef(ref: (result: RefNode, sheet: Sheet) => T): this {
    this.ref = ref;
    return this;
  }

  /**
   * `setBool` sets the mapping function for the boolean node.
   */
  setBool(bool: (result: BoolNode) => T): this {
    this.bool = bool;
    return this;
  }

  /**
   * `setNum` sets the mapping function for the number node.
   */
  setNum(num: (result: NumNode) => T): this {
    this.num = num;
    return this;
  }

  /**
   * `setStr` sets the mapping function for the string node.
   */
  setStr(str: (result: StrNode) => T): this {
    this.str = str;
    return this;
  }

  /**
   * `map` maps the given node to the expected node. If the node is ref and
   * the value is a range, it does not map the result to the expected node.
   */
  map(result: EvalNode, sheet?: Sheet): T {
    if (result.t === 'bool' && this.bool) {
      return this.bool(result);
    }

    if (result.t === 'num' && this.num) {
      return this.num(result);
    }

    if (result.t === 'str' && this.str) {
      return this.str(result);
    }

    if (result.t === 'ref' && this.ref && sheet) {
      return this.ref(result, sheet);
    }

    return result as T;
  }

  /**
   * `iterate` iterates over the arguments and yields the result.
   */
  *iterate(
    args: ArgsContext,
    visit: (tree: ParseTree) => EvalNode,
    sheet?: Sheet,
  ): Generator<T> {
    for (const expr of args.expr()) {
      const node = visit(expr);
      if (node.t === 'ref' && sheet) {
        for (const ref of toRefs([node.v])) {
          yield this.ref!({ t: 'ref', v: ref }, sheet);
        }
      } else {
        yield this.map(node);
      }
    }
  }
}

/**
 * `bool2num` converts a boolean result to a number result.
 */
function bool2num(result: BoolNode): NumNode {
  return { t: 'num', v: result.v ? 1 : 0 };
}

/**
 * `str2num` converts a string result to a number result.
 */
function str2num(result: StrNode): NumNode {
  const num = Number(result);
  return { t: 'num', v: isNaN(num) ? 0 : num };
}

/**
 * `ref2num` converts a reference result to a number result.
 */
export function ref2num(result: RefNode, sheet: Sheet): NumNode {
  const val = sheet.toDisplayString(result.v);
  const num = Number(val);
  return { t: 'num', v: isNaN(num) ? 0 : num };
}

/**
 * `NumberArgs` is a helper to build arguments for a number function.
 */
export const NumberArgs = Arguments.create<NumNode>()
  .setRef(ref2num)
  .setBool(bool2num)
  .setStr(str2num);
