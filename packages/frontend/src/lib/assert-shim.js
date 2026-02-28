// Minimal assert shim for browser environments.
//
// antlr4ts calls assert(condition) directly (CodePointBuffer, etc.).
// Instead of relying on the full assert@2.x polyfill whose CJS-to-ESM
// interop can break in Rollup production builds, this shim provides a
// lightweight callable assert that covers all antlr4ts usage.

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

export default assert;
export { assert };
