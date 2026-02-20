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
    name: 'PRODUCT',
    description: 'Multiplies a series of numbers',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'MEDIAN',
    description: 'Returns the middle number in a series',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'RAND',
    description: 'Returns a random number between 0 and 1',
    args: [],
  },
  {
    name: 'RANDBETWEEN',
    description: 'Returns a random integer between two values',
    args: [{ name: 'low' }, { name: 'high' }],
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
    name: 'IFS',
    description: 'Returns the first value whose condition is true',
    args: [
      { name: 'condition1' },
      { name: 'value1' },
      { name: 'condition2', optional: true, repeating: true },
      { name: 'value2', optional: true, repeating: true },
    ],
  },
  {
    name: 'SWITCH',
    description: 'Matches an expression against case/value pairs',
    args: [
      { name: 'expression' },
      { name: 'case1' },
      { name: 'value1' },
      { name: 'case2', optional: true, repeating: true },
      { name: 'value2', optional: true, repeating: true },
      { name: 'default', optional: true },
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
    name: 'COUNTBLANK',
    description: 'Counts empty cells',
    args: [
      { name: 'value1' },
      { name: 'value2', optional: true, repeating: true },
    ],
  },
  {
    name: 'COUNTIF',
    description: 'Counts values in a range that meet a criterion',
    args: [{ name: 'range' }, { name: 'criterion' }],
  },
  {
    name: 'SUMIF',
    description: 'Sums values in a range that meet a criterion',
    args: [
      { name: 'range' },
      { name: 'criterion' },
      { name: 'sum_range', optional: true },
    ],
  },
  {
    name: 'COUNTIFS',
    description: 'Counts values that meet multiple criteria',
    args: [
      { name: 'criteria_range1' },
      { name: 'criterion1' },
      { name: 'criteria_range2', optional: true, repeating: true },
      { name: 'criterion2', optional: true, repeating: true },
    ],
  },
  {
    name: 'SUMIFS',
    description: 'Sums values that meet multiple criteria',
    args: [
      { name: 'sum_range' },
      { name: 'criteria_range1' },
      { name: 'criterion1' },
      { name: 'criteria_range2', optional: true, repeating: true },
      { name: 'criterion2', optional: true, repeating: true },
    ],
  },
  {
    name: 'MATCH',
    description: 'Returns the position of an item in a one-dimensional range',
    args: [
      { name: 'search_key' },
      { name: 'range' },
      { name: 'search_type', optional: true },
    ],
  },
  {
    name: 'INDEX',
    description: 'Returns the value at a given row and column of a range',
    args: [
      { name: 'reference' },
      { name: 'row', optional: true },
      { name: 'column', optional: true },
    ],
  },
  {
    name: 'VLOOKUP',
    description: 'Looks up a value in the first column of a range',
    args: [
      { name: 'search_key' },
      { name: 'range' },
      { name: 'index' },
      { name: 'is_sorted', optional: true },
    ],
  },
  {
    name: 'HLOOKUP',
    description: 'Looks up a value in the first row of a range',
    args: [
      { name: 'search_key' },
      { name: 'range' },
      { name: 'index' },
      { name: 'is_sorted', optional: true },
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
    name: 'CONCAT',
    description: 'Joins text values into one string',
    args: [
      { name: 'text1' },
      { name: 'text2' },
      { name: 'text3', optional: true, repeating: true },
    ],
  },
  {
    name: 'FIND',
    description: 'Finds one text value inside another (case-sensitive)',
    args: [
      { name: 'search_for' },
      { name: 'text_to_search' },
      { name: 'starting_at', optional: true },
    ],
  },
  {
    name: 'SEARCH',
    description: 'Finds one text value inside another (case-insensitive)',
    args: [
      { name: 'search_for' },
      { name: 'text_to_search' },
      { name: 'starting_at', optional: true },
    ],
  },
  {
    name: 'TEXTJOIN',
    description: 'Joins text values with a delimiter',
    args: [
      { name: 'delimiter' },
      { name: 'ignore_empty' },
      { name: 'text1' },
      { name: 'text2', optional: true, repeating: true },
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
    name: 'DATE',
    description: 'Returns a date from year, month, and day values',
    args: [{ name: 'year' }, { name: 'month' }, { name: 'day' }],
  },
  {
    name: 'TIME',
    description: 'Returns a time from hour, minute, and second values',
    args: [{ name: 'hour' }, { name: 'minute' }, { name: 'second' }],
  },
  {
    name: 'DAYS',
    description: 'Returns the number of days between two dates',
    args: [{ name: 'end_date' }, { name: 'start_date' }],
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
    name: 'HOUR',
    description: 'Returns the hour from a date/time (0-23)',
    args: [{ name: 'time' }],
  },
  {
    name: 'MINUTE',
    description: 'Returns the minute from a date/time (0-59)',
    args: [{ name: 'time' }],
  },
  {
    name: 'SECOND',
    description: 'Returns the second from a date/time (0-59)',
    args: [{ name: 'time' }],
  },
  {
    name: 'WEEKDAY',
    description: 'Returns day of the week as a number',
    args: [{ name: 'date' }, { name: 'type', optional: true }],
  },
  {
    name: 'ISBLANK',
    description: 'Checks whether a value is blank',
    args: [{ name: 'value' }],
  },
  {
    name: 'ISNUMBER',
    description: 'Checks whether a value is a number',
    args: [{ name: 'value' }],
  },
  {
    name: 'ISTEXT',
    description: 'Checks whether a value is text',
    args: [{ name: 'value' }],
  },
  {
    name: 'ISERROR',
    description: 'Checks whether a value is any error',
    args: [{ name: 'value' }],
  },
  {
    name: 'ISERR',
    description: 'Checks whether a value is an error except #N/A!',
    args: [{ name: 'value' }],
  },
  {
    name: 'ISNA',
    description: 'Checks whether a value is the #N/A! error',
    args: [{ name: 'value' }],
  },
  {
    name: 'ISLOGICAL',
    description: 'Checks whether a value is boolean',
    args: [{ name: 'value' }],
  },
  {
    name: 'ISNONTEXT',
    description: 'Checks whether a value is not text',
    args: [{ name: 'value' }],
  },
  {
    name: 'IFERROR',
    description: 'Returns a value if no error, otherwise returns an alternate value',
    args: [{ name: 'value' }, { name: 'value_if_error' }],
  },
  {
    name: 'IFNA',
    description: 'Returns a value if no #N/A! error, otherwise returns an alternate value',
    args: [{ name: 'value' }, { name: 'value_if_na' }],
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
