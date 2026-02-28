// Self-contained Node.js `util` shim for browser environments.
//
// antlr4ts requires: util.inspect.custom, assert (which needs util.isPromise etc.)
// This shim provides all required symbols without importing the `util` npm
// polyfill (which would create an alias recursion loop).

export const inspect = Object.assign(
  function inspect(obj) {
    if (obj === null) return "null";
    if (obj === undefined) return "undefined";
    if (typeof obj === "string") return JSON.stringify(obj);
    if (typeof obj !== "object") return String(obj);
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  },
  {
    custom: Symbol.for("nodejs.util.inspect.custom"),
    colors: {},
    styles: {},
  },
);

export function format(f, ...args) {
  if (typeof f !== "string") return args.map(String).join(" ");
  let i = 0;
  return f.replace(/%[sdj%]/g, (m) => {
    if (m === "%%") return "%";
    if (i >= args.length) return m;
    const v = args[i++];
    if (m === "%s") return String(v);
    if (m === "%d") return Number(v);
    if (m === "%j") {
      try { return JSON.stringify(v); } catch { return "[Circular]"; }
    }
    return m;
  });
}

export function inherits(ctor, superCtor) {
  ctor.super_ = superCtor;
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

export function deprecate(fn, msg) {
  let warned = false;
  return function (...args) {
    if (!warned) {
      console.warn(msg);
      warned = true;
    }
    return fn.apply(this, args);
  };
}

export function debuglog() {
  return function () {};
}

// Type checks required by assert@2.x
export function isPromise(val) {
  return val != null && typeof val.then === "function";
}

export function isRegExp(val) {
  return val instanceof RegExp;
}

export function isDate(val) {
  return val instanceof Date;
}

export function isError(val) {
  return val instanceof Error;
}

export function isFunction(val) {
  return typeof val === "function";
}

export function isPrimitive(val) {
  return val === null || (typeof val !== "object" && typeof val !== "function");
}

export function isBuffer() {
  return false;
}

export function isNull(val) {
  return val === null;
}

export function isNullOrUndefined(val) {
  return val == null;
}

export function isUndefined(val) {
  return val === undefined;
}

export function isString(val) {
  return typeof val === "string";
}

export function isNumber(val) {
  return typeof val === "number";
}

export function isObject(val) {
  return typeof val === "object" && val !== null;
}

export function isBoolean(val) {
  return typeof val === "boolean";
}

export function isSymbol(val) {
  return typeof val === "symbol";
}

export function isArray(val) {
  return Array.isArray(val);
}

// assert@2.x accesses require('util/').types.isPromise etc.
export const types = {
  isPromise,
  isRegExp,
  isDate,
};

export default {
  inspect,
  format,
  inherits,
  deprecate,
  debuglog,
  types,
  isPromise,
  isRegExp,
  isDate,
  isError,
  isFunction,
  isPrimitive,
  isBuffer,
  isNull,
  isNullOrUndefined,
  isUndefined,
  isString,
  isNumber,
  isObject,
  isBoolean,
  isSymbol,
  isArray,
};
