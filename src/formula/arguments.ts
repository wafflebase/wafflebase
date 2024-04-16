import {
  EvaluationResult,
  BooleanResult,
  NumberResult,
  StringResult,
} from './formula';

/**
 * Arguments is a helper class to build arguments for a function.
 */
class Arguments<T extends EvaluationResult> {
  private bool?: (result: BooleanResult) => T;
  private num?: (result: NumberResult) => T;
  private str?: (result: StringResult) => T;

  static create<T extends EvaluationResult>(): Arguments<T> {
    return new Arguments<T>();
  }

  setBool(bool: (result: BooleanResult) => T): this {
    this.bool = bool;
    return this;
  }

  setStr(str: (result: StringResult) => T): this {
    this.str = str;
    return this;
  }

  map(result: EvaluationResult): T {
    if (result.t === 'boolean' && this.bool) {
      return this.bool(result);
    }

    if (result.t === 'number' && this.num) {
      return this.num(result);
    }

    if (result.t === 'string' && this.str) {
      return this.str(result);
    }

    return result as T;
  }
}

/**
 * `bool2num` converts a boolean result to a number result.
 */
function bool2num(result: BooleanResult): NumberResult {
  return { t: 'number', v: result.v ? 1 : 0 };
}

/**
 * `str2num` converts a string result to a number result.
 */
function str2num(result: StringResult): NumberResult {
  return { t: 'number', v: result.v === '' ? 0 : Number(result.v) };
}

/**
 * `NumberArgs` is a helper to build arguments for a number function.
 */
export const NumberArgs = Arguments.create<NumberResult>()
  .setBool(bool2num)
  .setStr(str2num);
