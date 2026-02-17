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
    name: 'ABS',
    description: 'Returns the absolute value of a number',
    args: [{ name: 'number' }],
  },
  {
    name: 'ROUND',
    description: 'Rounds a number to a certain number of decimal places',
    args: [{ name: 'value' }, { name: 'places', optional: true }],
  },
  {
    name: 'ROUNDUP',
    description: 'Rounds a number away from zero',
    args: [{ name: 'value' }, { name: 'places', optional: true }],
  },
  {
    name: 'ROUNDDOWN',
    description: 'Rounds a number toward zero',
    args: [{ name: 'value' }, { name: 'places', optional: true }],
  },
  {
    name: 'INT',
    description: 'Rounds a number down to the nearest integer',
    args: [{ name: 'value' }],
  },
  {
    name: 'MOD',
    description: 'Returns the remainder after division',
    args: [{ name: 'dividend' }, { name: 'divisor' }],
  },
  {
    name: 'SQRT',
    description: 'Returns the positive square root of a number',
    args: [{ name: 'value' }],
  },
  {
    name: 'POWER',
    description: 'Returns a number raised to a power',
    args: [{ name: 'base' }, { name: 'exponent' }],
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
  {
    name: 'AVERAGE',
    description: 'Returns the average of a series of numbers',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'MIN',
    description: 'Returns the smallest value in a set of numbers',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'MAX',
    description: 'Returns the largest value in a set of numbers',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'COUNT',
    description: 'Counts the number of numeric values',
    args: [
      { name: 'value1' },
      { name: 'value2', optional: true, repeating: true },
    ],
  },
  {
    name: 'COUNTA',
    description: 'Counts the number of non-empty values',
    args: [
      { name: 'value1' },
      { name: 'value2', optional: true, repeating: true },
    ],
  },
  {
    name: 'TRIM',
    description: 'Removes leading and trailing whitespace from text',
    args: [{ name: 'text' }],
  },
  {
    name: 'LEN',
    description: 'Returns the number of characters in a text string',
    args: [{ name: 'text' }],
  },
  {
    name: 'LEFT',
    description: 'Returns the leftmost characters from a text string',
    args: [{ name: 'text' }, { name: 'num_chars', optional: true }],
  },
  {
    name: 'RIGHT',
    description: 'Returns the rightmost characters from a text string',
    args: [{ name: 'text' }, { name: 'num_chars', optional: true }],
  },
  {
    name: 'MID',
    description: 'Returns characters from the middle of a text string',
    args: [{ name: 'text' }, { name: 'start_num' }, { name: 'num_chars' }],
  },
  {
    name: 'CONCATENATE',
    description: 'Joins two or more text strings into one',
    args: [
      { name: 'text1' },
      { name: 'text2' },
      { name: 'text3', optional: true, repeating: true },
    ],
  },
  {
    name: 'LOWER',
    description: 'Converts text to lowercase',
    args: [{ name: 'text' }],
  },
  {
    name: 'UPPER',
    description: 'Converts text to uppercase',
    args: [{ name: 'text' }],
  },
  {
    name: 'PROPER',
    description: 'Capitalizes each word in text',
    args: [{ name: 'text' }],
  },
  {
    name: 'SUBSTITUTE',
    description: 'Replaces existing text with new text in a string',
    args: [
      { name: 'text' },
      { name: 'search_for' },
      { name: 'replace_with' },
      { name: 'occurrence', optional: true },
    ],
  },
  {
    name: 'TODAY',
    description: 'Returns the current date',
    args: [],
  },
  {
    name: 'NOW',
    description: 'Returns the current date and time',
    args: [],
  },
  {
    name: 'YEAR',
    description: 'Returns the year from a date',
    args: [{ name: 'date' }],
  },
  {
    name: 'MONTH',
    description: 'Returns the month from a date (1-12)',
    args: [{ name: 'date' }],
  },
  {
    name: 'DAY',
    description: 'Returns the day of the month from a date (1-31)',
    args: [{ name: 'date' }],
  },
  {
    name: 'IFERROR',
    description: 'Returns a value if no error, otherwise returns an alternate value',
    args: [{ name: 'value' }, { name: 'value_if_error' }],
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
