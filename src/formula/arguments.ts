import { Sheet } from '../sheet/sheet';
import { EvalNode, BoolNode, NumNode, StrNode, RefNode } from './formula';

/**
 * Arguments is a helper to build arguments for a function.
 */
class Arguments<T extends EvalNode> {
  private bool?: (result: BoolNode) => T;
  private num?: (result: NumNode) => T;
  private str?: (result: StrNode) => T;
  private ref?: (result: RefNode, sheet: Sheet) => T;

  static create<T extends EvalNode>(): Arguments<T> {
    return new Arguments<T>();
  }

  setBool(bool: (result: BoolNode) => T): this {
    this.bool = bool;
    return this;
  }

  setStr(str: (result: StrNode) => T): this {
    this.str = str;
    return this;
  }

  setRef(ref: (result: RefNode, sheet: Sheet) => T): this {
    this.ref = ref;
    return this;
  }

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
