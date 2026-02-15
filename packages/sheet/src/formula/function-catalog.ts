/**
 * FunctionInfo describes a spreadsheet function for autocomplete display.
 */
export type FunctionArg = {
  name: string;
  optional?: boolean;
  repeating?: boolean;
};

export type FunctionInfo = {
  name: string;
  description: string;
  args: FunctionArg[];
};

/**
 * FunctionCatalog lists all built-in functions with metadata for autocomplete.
 */
export const FunctionCatalog: FunctionInfo[] = [
  {
    name: 'SUM',
    description: 'Returns the sum of a series of numbers',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'IF',
    description: 'Returns one value if true and another if false',
    args: [
      { name: 'condition' },
      { name: 'value_if_true' },
      { name: 'value_if_false', optional: true },
    ],
  },
  {
    name: 'AND',
    description: 'Returns TRUE if all arguments are true',
    args: [
      { name: 'logical1' },
      { name: 'logical2', optional: true, repeating: true },
    ],
  },
  {
    name: 'OR',
    description: 'Returns TRUE if any argument is true',
    args: [
      { name: 'logical1' },
      { name: 'logical2', optional: true, repeating: true },
    ],
  },
  {
    name: 'NOT',
    description: 'Returns the opposite of a logical value',
    args: [{ name: 'logical' }],
  },
];

/**
 * `searchFunctions` returns functions whose name starts with the given prefix (case-insensitive).
 */
export function searchFunctions(prefix: string): FunctionInfo[] {
  const upper = prefix.toUpperCase();
  return FunctionCatalog.filter((f) => f.name.startsWith(upper));
}

/**
 * `findFunction` returns a function by exact name (case-insensitive), or undefined.
 */
export function findFunction(name: string): FunctionInfo | undefined {
  const upper = name.toUpperCase();
  return FunctionCatalog.find((f) => f.name === upper);
}

/**
 * `formatSignature` renders a function signature like `SUM(number1, [number2], ...)`.
 */
export function formatSignature(info: FunctionInfo): string {
  const args = info.args.map((a) => {
    let s = a.optional ? `[${a.name}]` : a.name;
    if (a.repeating) {
      s += ', ...';
    }
    return s;
  });
  return `${info.name}(${args.join(', ')})`;
}
