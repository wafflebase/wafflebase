// Minimal assert shim for browser environments.
//
// antlr4ts calls assert(condition) directly (CodePointBuffer, etc.).
// This MUST use CJS module.exports so that esbuild's pre-bundling
// keeps assert as a callable function. ESM export default gets wrapped
// by __toCommonJS into { default: fn } which is not callable.

function assert(value, message) {
  if (!value) {
    throw new Error(message || "Assertion failed");
  }
}

assert.ok = assert;

assert.equal = function (actual, expected, message) {
  if (actual != expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
};

assert.strictEqual = function (actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
};

module.exports = assert;
