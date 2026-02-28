// Minimal Node.js `util` shim for antlr4ts running in the browser.
// antlr4ts/misc/BitSet.js uses `util.inspect.custom` as a computed
// property name. Provide the symbol so the property definition succeeds.
export const inspect = {
  custom: Symbol.for("nodejs.util.inspect.custom"),
};

export default { inspect };
