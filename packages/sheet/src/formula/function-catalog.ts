/**
 * FunctionInfo describes a spreadsheet function for autocomplete display.
 */
export type FunctionArg = {
  name: string;
  optional?: boolean;
  repeating?: boolean;
};

export const SheetsFunctionCategoryOrder = [
  'Date',
  'Engineering',
  'Filter',
  'Financial',
  'Info',
  'Logical',
  'Lookup',
  'Math',
  'Operator',
  'Statistical',
  'Text',
  'Database',
  'Parser',
  'Array',
  'Web',
] as const;

export type FunctionCategory = (typeof SheetsFunctionCategoryOrder)[number];

export type FunctionInfo = {
  name: string;
  category: FunctionCategory;
  description: string;
  args: FunctionArg[];
};

/**
 * FunctionCatalog lists all built-in functions with metadata for autocomplete.
 */
const FunctionCatalogEntries: Array<Omit<FunctionInfo, 'category'>> = [
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
  {
    name: 'PI',
    description: 'Returns the value of Pi',
    args: [],
  },
  {
    name: 'SIGN',
    description: 'Returns the sign of a number (-1, 0, or 1)',
    args: [{ name: 'number' }],
  },
  {
    name: 'EVEN',
    description: 'Rounds a number up to the nearest even integer',
    args: [{ name: 'number' }],
  },
  {
    name: 'ODD',
    description: 'Rounds a number up to the nearest odd integer',
    args: [{ name: 'number' }],
  },
  {
    name: 'EXP',
    description: 'Returns Euler\'s number raised to a power',
    args: [{ name: 'exponent' }],
  },
  {
    name: 'LN',
    description: 'Returns the natural logarithm of a number',
    args: [{ name: 'number' }],
  },
  {
    name: 'LOG',
    description: 'Returns the logarithm of a number given a base',
    args: [{ name: 'number' }, { name: 'base', optional: true }],
  },
  {
    name: 'SIN',
    description: 'Returns the sine of an angle in radians',
    args: [{ name: 'angle' }],
  },
  {
    name: 'COS',
    description: 'Returns the cosine of an angle in radians',
    args: [{ name: 'angle' }],
  },
  {
    name: 'TAN',
    description: 'Returns the tangent of an angle in radians',
    args: [{ name: 'angle' }],
  },
  {
    name: 'ASIN',
    description: 'Returns the inverse sine of a value in radians',
    args: [{ name: 'value' }],
  },
  {
    name: 'ACOS',
    description: 'Returns the inverse cosine of a value in radians',
    args: [{ name: 'value' }],
  },
  {
    name: 'ATAN',
    description: 'Returns the inverse tangent of a value in radians',
    args: [{ name: 'value' }],
  },
  {
    name: 'ATAN2',
    description: 'Returns the angle between the x-axis and a point',
    args: [{ name: 'x' }, { name: 'y' }],
  },
  {
    name: 'DEGREES',
    description: 'Converts an angle from radians to degrees',
    args: [{ name: 'angle' }],
  },
  {
    name: 'RADIANS',
    description: 'Converts an angle from degrees to radians',
    args: [{ name: 'angle' }],
  },
  {
    name: 'CEILING',
    description: 'Rounds a number up to the nearest multiple of significance',
    args: [{ name: 'number' }, { name: 'significance', optional: true }],
  },
  {
    name: 'FLOOR',
    description: 'Rounds a number down to the nearest multiple of significance',
    args: [{ name: 'number' }, { name: 'significance', optional: true }],
  },
  {
    name: 'TRUNC',
    description: 'Truncates a number to a given number of decimal places',
    args: [{ name: 'number' }, { name: 'places', optional: true }],
  },
  {
    name: 'MROUND',
    description: 'Rounds a number to the nearest specified multiple',
    args: [{ name: 'number' }, { name: 'multiple' }],
  },
  {
    name: 'EXACT',
    description: 'Tests whether two strings are identical (case-sensitive)',
    args: [{ name: 'text1' }, { name: 'text2' }],
  },
  {
    name: 'REPLACE',
    description: 'Replaces part of a text string with a different text string',
    args: [{ name: 'old_text' }, { name: 'start_num' }, { name: 'num_chars' }, { name: 'new_text' }],
  },
  {
    name: 'REPT',
    description: 'Repeats text a given number of times',
    args: [{ name: 'text' }, { name: 'number_times' }],
  },
  {
    name: 'T',
    description: 'Returns the text referred to by value',
    args: [{ name: 'value' }],
  },
  {
    name: 'VALUE',
    description: 'Converts a text string that represents a number to a number',
    args: [{ name: 'text' }],
  },
  {
    name: 'TEXT',
    description: 'Formats a number and converts it to text',
    args: [{ name: 'number' }, { name: 'format' }],
  },
  {
    name: 'CHAR',
    description: 'Returns the character specified by the code number',
    args: [{ name: 'number' }],
  },
  {
    name: 'CODE',
    description: 'Returns a numeric code for the first character in a text string',
    args: [{ name: 'text' }],
  },
  {
    name: 'AVERAGEIF',
    description: 'Returns the average of a range that meets a criterion',
    args: [
      { name: 'criteria_range' },
      { name: 'criterion' },
      { name: 'average_range', optional: true },
    ],
  },
  {
    name: 'AVERAGEIFS',
    description: 'Returns the average of a range that meets multiple criteria',
    args: [
      { name: 'average_range' },
      { name: 'criteria_range1' },
      { name: 'criterion1' },
      { name: 'criteria_range2', optional: true, repeating: true },
      { name: 'criterion2', optional: true, repeating: true },
    ],
  },
  {
    name: 'LARGE',
    description: 'Returns the nth largest value in a data set',
    args: [{ name: 'data' }, { name: 'n' }],
  },
  {
    name: 'SMALL',
    description: 'Returns the nth smallest value in a data set',
    args: [{ name: 'data' }, { name: 'n' }],
  },
  {
    name: 'N',
    description: 'Converts a value to a number',
    args: [{ name: 'value' }],
  },
  {
    name: 'SUMPRODUCT',
    description: 'Multiplies corresponding components and returns the sum',
    args: [
      { name: 'array1' },
      { name: 'array2', optional: true, repeating: true },
    ],
  },
  {
    name: 'GCD',
    description: 'Returns the greatest common divisor',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'LCM',
    description: 'Returns the least common multiple',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'COMBIN',
    description: 'Returns the number of combinations for a given number of items',
    args: [{ name: 'n' }, { name: 'k' }],
  },
  {
    name: 'FACT',
    description: 'Returns the factorial of a number',
    args: [{ name: 'number' }],
  },
  {
    name: 'QUOTIENT',
    description: 'Returns the integer portion of a division',
    args: [{ name: 'numerator' }, { name: 'denominator' }],
  },
  {
    name: 'XOR',
    description: 'Returns TRUE if an odd number of arguments are TRUE',
    args: [
      { name: 'logical1' },
      { name: 'logical2', optional: true, repeating: true },
    ],
  },
  {
    name: 'CHOOSE',
    description: 'Returns a value from a list based on index',
    args: [
      { name: 'index' },
      { name: 'value1' },
      { name: 'value2', optional: true, repeating: true },
    ],
  },
  {
    name: 'TYPE',
    description: 'Returns a number indicating the data type of a value',
    args: [{ name: 'value' }],
  },
  {
    name: 'EDATE',
    description: 'Returns a date a specified number of months before or after another date',
    args: [{ name: 'start_date' }, { name: 'months' }],
  },
  {
    name: 'EOMONTH',
    description: 'Returns the last day of the month a specified number of months away',
    args: [{ name: 'start_date' }, { name: 'months' }],
  },
  {
    name: 'NETWORKDAYS',
    description: 'Returns the number of net working days between two dates',
    args: [{ name: 'start_date' }, { name: 'end_date' }, { name: 'holidays', optional: true }],
  },
  {
    name: 'DATEVALUE',
    description: 'Converts a date string to a date value',
    args: [{ name: 'date_string' }],
  },
  {
    name: 'TIMEVALUE',
    description: 'Returns the fraction of the day a time represents',
    args: [{ name: 'time_string' }],
  },
  {
    name: 'DATEDIF',
    description: 'Calculates the number of days, months, or years between two dates',
    args: [{ name: 'start_date' }, { name: 'end_date' }, { name: 'unit' }],
  },
  {
    name: 'ROW',
    description: 'Returns the row number of a reference',
    args: [{ name: 'reference', optional: true }],
  },
  {
    name: 'COLUMN',
    description: 'Returns the column number of a reference',
    args: [{ name: 'reference', optional: true }],
  },
  {
    name: 'ROWS',
    description: 'Returns the number of rows in a range',
    args: [{ name: 'range' }],
  },
  {
    name: 'COLUMNS',
    description: 'Returns the number of columns in a range',
    args: [{ name: 'range' }],
  },
  {
    name: 'ADDRESS',
    description: 'Returns a cell reference as text given row and column numbers',
    args: [
      { name: 'row' },
      { name: 'column' },
      { name: 'abs_num', optional: true },
      { name: 'a1', optional: true },
    ],
  },
  {
    name: 'HYPERLINK',
    description: 'Creates a hyperlink in a cell',
    args: [{ name: 'url' }, { name: 'link_label', optional: true }],
  },
  {
    name: 'MINIFS',
    description: 'Returns the minimum value in a range that meets multiple criteria',
    args: [
      { name: 'min_range' },
      { name: 'criteria_range1' },
      { name: 'criterion1' },
      { name: 'criteria_range2', optional: true, repeating: true },
      { name: 'criterion2', optional: true, repeating: true },
    ],
  },
  {
    name: 'MAXIFS',
    description: 'Returns the maximum value in a range that meets multiple criteria',
    args: [
      { name: 'max_range' },
      { name: 'criteria_range1' },
      { name: 'criterion1' },
      { name: 'criteria_range2', optional: true, repeating: true },
      { name: 'criterion2', optional: true, repeating: true },
    ],
  },
  {
    name: 'RANK',
    description: 'Returns the rank of a value within a data set',
    args: [
      { name: 'value' },
      { name: 'data' },
      { name: 'order', optional: true },
    ],
  },
  {
    name: 'PERCENTILE',
    description: 'Returns the k-th percentile of a data set',
    args: [{ name: 'data' }, { name: 'k' }],
  },
  {
    name: 'CLEAN',
    description: 'Removes all non-printable characters from text',
    args: [{ name: 'text' }],
  },
  {
    name: 'NUMBERVALUE',
    description: 'Converts text to a number in a locale-independent way',
    args: [
      { name: 'text' },
      { name: 'decimal_separator', optional: true },
      { name: 'group_separator', optional: true },
    ],
  },
  {
    name: 'STDEV',
    description: 'Returns the sample standard deviation',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'STDEVP',
    description: 'Returns the population standard deviation',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'VAR',
    description: 'Returns the sample variance',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'VARP',
    description: 'Returns the population variance',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'MODE',
    description: 'Returns the most frequently occurring value',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'SUMSQ',
    description: 'Returns the sum of the squares of the arguments',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'NA',
    description: 'Returns the #N/A! error value',
    args: [],
  },
  {
    name: 'QUARTILE',
    description: 'Returns the quartile of a data set',
    args: [{ name: 'data' }, { name: 'quart' }],
  },
  {
    name: 'COUNTUNIQUE',
    description: 'Counts the number of unique values in a list',
    args: [
      { name: 'value1' },
      { name: 'value2', optional: true, repeating: true },
    ],
  },
  {
    name: 'FIXED',
    description: 'Formats a number with a fixed number of decimal places',
    args: [
      { name: 'number' },
      { name: 'decimals', optional: true },
      { name: 'no_commas', optional: true },
    ],
  },
  {
    name: 'DOLLAR',
    description: 'Formats a number as currency with a dollar sign',
    args: [{ name: 'number' }, { name: 'decimals', optional: true }],
  },
  {
    name: 'WEEKNUM',
    description: 'Returns the week number of the year',
    args: [{ name: 'date' }, { name: 'type', optional: true }],
  },
  {
    name: 'ISOWEEKNUM',
    description: 'Returns the ISO week number of the year',
    args: [{ name: 'date' }],
  },
  {
    name: 'WORKDAY',
    description: 'Returns a date that is a specified number of working days away',
    args: [{ name: 'start_date' }, { name: 'days' }, { name: 'holidays', optional: true }],
  },
  {
    name: 'YEARFRAC',
    description: 'Returns the fraction of the year between two dates',
    args: [{ name: 'start_date' }, { name: 'end_date' }, { name: 'basis', optional: true }],
  },
  {
    name: 'LOOKUP',
    description: 'Searches a sorted range for a key',
    args: [
      { name: 'search_key' },
      { name: 'search_range' },
      { name: 'result_range', optional: true },
    ],
  },
  {
    name: 'INDIRECT',
    description: 'Returns the reference specified by a text string',
    args: [{ name: 'cell_reference' }, { name: 'is_A1_notation', optional: true }],
  },
  {
    name: 'ERROR.TYPE',
    description: 'Returns a number corresponding to the error type',
    args: [{ name: 'value' }],
  },
  {
    name: 'ISDATE',
    description: 'Checks whether a value is a date',
    args: [{ name: 'value' }],
  },
  {
    name: 'SPLIT',
    description: 'Splits text around a delimiter',
    args: [
      { name: 'text' },
      { name: 'delimiter' },
      { name: 'split_by_each', optional: true },
      { name: 'remove_empty', optional: true },
    ],
  },
  {
    name: 'JOIN',
    description: 'Joins values with a delimiter',
    args: [
      { name: 'delimiter' },
      { name: 'value1' },
      { name: 'value2', optional: true, repeating: true },
    ],
  },
  {
    name: 'REGEXMATCH',
    description: 'Returns whether text matches a regular expression',
    args: [{ name: 'text' }, { name: 'regular_expression' }],
  },
  {
    name: 'FORECAST',
    description: 'Predicts a y-value for a given x using linear regression',
    args: [{ name: 'x' }, { name: 'known_ys' }, { name: 'known_xs' }],
  },
  {
    name: 'SLOPE',
    description: 'Returns the slope of the linear regression line',
    args: [{ name: 'known_ys' }, { name: 'known_xs' }],
  },
  {
    name: 'INTERCEPT',
    description: 'Returns the y-intercept of the linear regression line',
    args: [{ name: 'known_ys' }, { name: 'known_xs' }],
  },
  {
    name: 'CORREL',
    description: 'Returns the Pearson correlation coefficient',
    args: [{ name: 'data_y' }, { name: 'data_x' }],
  },
  {
    name: 'XLOOKUP',
    description: 'Searches a range for a match and returns a corresponding item',
    args: [
      { name: 'search_key' },
      { name: 'lookup_range' },
      { name: 'return_range' },
      { name: 'if_not_found', optional: true },
      { name: 'match_mode', optional: true },
      { name: 'search_mode', optional: true },
    ],
  },
  {
    name: 'OFFSET',
    description: 'Returns a reference offset from a starting reference',
    args: [
      { name: 'reference' },
      { name: 'rows' },
      { name: 'cols' },
      { name: 'height', optional: true },
      { name: 'width', optional: true },
    ],
  },
  {
    name: 'ISEVEN',
    description: 'Checks whether a number is even',
    args: [{ name: 'number' }],
  },
  {
    name: 'ISODD',
    description: 'Checks whether a number is odd',
    args: [{ name: 'number' }],
  },
  {
    name: 'FACTDOUBLE',
    description: 'Returns the double factorial of a number',
    args: [{ name: 'number' }],
  },
  {
    name: 'BASE',
    description: 'Converts a number to text in another base',
    args: [{ name: 'number' }, { name: 'base' }, { name: 'min_length', optional: true }],
  },
  {
    name: 'DECIMAL',
    description: 'Converts text from another base to a decimal number',
    args: [{ name: 'text' }, { name: 'base' }],
  },
  {
    name: 'SQRTPI',
    description: 'Returns the square root of number * PI',
    args: [{ name: 'number' }],
  },
  {
    name: 'SINH',
    description: 'Returns the hyperbolic sine of a number',
    args: [{ name: 'number' }],
  },
  {
    name: 'COSH',
    description: 'Returns the hyperbolic cosine of a number',
    args: [{ name: 'number' }],
  },
  {
    name: 'TANH',
    description: 'Returns the hyperbolic tangent of a number',
    args: [{ name: 'number' }],
  },
  {
    name: 'ASINH',
    description: 'Returns the inverse hyperbolic sine of a number',
    args: [{ name: 'number' }],
  },
  {
    name: 'ACOSH',
    description: 'Returns the inverse hyperbolic cosine of a number',
    args: [{ name: 'number' }],
  },
  {
    name: 'ATANH',
    description: 'Returns the inverse hyperbolic tangent of a number',
    args: [{ name: 'number' }],
  },
  {
    name: 'COT',
    description: 'Returns the cotangent of an angle in radians',
    args: [{ name: 'angle' }],
  },
  {
    name: 'CSC',
    description: 'Returns the cosecant of an angle in radians',
    args: [{ name: 'angle' }],
  },
  {
    name: 'SEC',
    description: 'Returns the secant of an angle in radians',
    args: [{ name: 'angle' }],
  },
  {
    name: 'REGEXEXTRACT',
    description: 'Extracts matching substrings using a regular expression',
    args: [{ name: 'text' }, { name: 'regular_expression' }],
  },
  {
    name: 'REGEXREPLACE',
    description: 'Replaces text matching a regular expression',
    args: [{ name: 'text' }, { name: 'regular_expression' }, { name: 'replacement' }],
  },
  {
    name: 'UNICODE',
    description: 'Returns the Unicode code point of the first character',
    args: [{ name: 'text' }],
  },
  {
    name: 'UNICHAR',
    description: 'Returns the Unicode character for a code point',
    args: [{ name: 'number' }],
  },
  {
    name: 'GEOMEAN',
    description: 'Returns the geometric mean',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'HARMEAN',
    description: 'Returns the harmonic mean',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'AVEDEV',
    description: 'Returns the average absolute deviation from the mean',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'DEVSQ',
    description: 'Returns the sum of squared deviations from the mean',
    args: [
      { name: 'number1' },
      { name: 'number2', optional: true, repeating: true },
    ],
  },
  {
    name: 'TRIMMEAN',
    description: 'Returns the mean of the interior portion of a data set',
    args: [{ name: 'data' }, { name: 'percent' }],
  },
  {
    name: 'PERMUT',
    description: 'Returns the number of permutations for a given number of objects',
    args: [{ name: 'n' }, { name: 'k' }],
  },
  {
    name: 'PMT',
    description: 'Returns the periodic payment for an annuity',
    args: [
      { name: 'rate' },
      { name: 'nper' },
      { name: 'pv' },
      { name: 'fv', optional: true },
      { name: 'type', optional: true },
    ],
  },
  {
    name: 'FV',
    description: 'Returns the future value of an investment',
    args: [
      { name: 'rate' },
      { name: 'nper' },
      { name: 'pmt' },
      { name: 'pv', optional: true },
      { name: 'type', optional: true },
    ],
  },
  {
    name: 'PV',
    description: 'Returns the present value of an investment',
    args: [
      { name: 'rate' },
      { name: 'nper' },
      { name: 'pmt' },
      { name: 'fv', optional: true },
      { name: 'type', optional: true },
    ],
  },
  {
    name: 'NPV',
    description: 'Returns the net present value of an investment',
    args: [
      { name: 'rate' },
      { name: 'value1' },
      { name: 'value2', optional: true, repeating: true },
    ],
  },
  {
    name: 'NPER',
    description: 'Returns the number of periods for an investment',
    args: [
      { name: 'rate' },
      { name: 'pmt' },
      { name: 'pv' },
      { name: 'fv', optional: true },
      { name: 'type', optional: true },
    ],
  },
  {
    name: 'IPMT',
    description: 'Returns the interest portion of a payment',
    args: [
      { name: 'rate' },
      { name: 'period' },
      { name: 'nper' },
      { name: 'pv' },
      { name: 'fv', optional: true },
      { name: 'type', optional: true },
    ],
  },
  {
    name: 'PPMT',
    description: 'Returns the principal portion of a payment',
    args: [
      { name: 'rate' },
      { name: 'period' },
      { name: 'nper' },
      { name: 'pv' },
      { name: 'fv', optional: true },
      { name: 'type', optional: true },
    ],
  },
  {
    name: 'SLN',
    description: 'Returns the straight-line depreciation of an asset',
    args: [{ name: 'cost' }, { name: 'salvage' }, { name: 'life' }],
  },
  {
    name: 'EFFECT',
    description: 'Returns the effective annual interest rate',
    args: [{ name: 'nominal_rate' }, { name: 'periods_per_year' }],
  },
];

const FunctionNamesByCategory: Partial<Record<FunctionCategory, ReadonlySet<string>>> = {
  Date: new Set([
    'TODAY',
    'NOW',
    'DATE',
    'TIME',
    'DAYS',
    'YEAR',
    'MONTH',
    'DAY',
    'HOUR',
    'MINUTE',
    'SECOND',
    'WEEKDAY',
    'EDATE',
    'EOMONTH',
    'NETWORKDAYS',
    'DATEVALUE',
    'TIMEVALUE',
    'DATEDIF',
    'WEEKNUM',
    'ISOWEEKNUM',
    'WORKDAY',
    'YEARFRAC',
  ]),
  Financial: new Set(['PMT', 'FV', 'PV', 'NPV', 'NPER', 'IPMT', 'PPMT', 'SLN', 'EFFECT']),
  Info: new Set([
    'ISBLANK',
    'ISNUMBER',
    'ISTEXT',
    'ISERROR',
    'ISERR',
    'ISNA',
    'ISLOGICAL',
    'ISNONTEXT',
    'N',
    'TYPE',
    'NA',
    'ERROR.TYPE',
    'ISDATE',
  ]),
  Logical: new Set(['IF', 'IFS', 'SWITCH', 'AND', 'OR', 'NOT', 'IFERROR', 'IFNA', 'XOR', 'CHOOSE']),
  Lookup: new Set(['MATCH', 'INDEX', 'VLOOKUP', 'HLOOKUP', 'ROW', 'COLUMN', 'ROWS', 'COLUMNS', 'ADDRESS', 'HYPERLINK', 'LOOKUP', 'INDIRECT', 'XLOOKUP', 'OFFSET']),
  Math: new Set([
    'SUM',
    'ABS',
    'ROUND',
    'ROUNDUP',
    'ROUNDDOWN',
    'INT',
    'MOD',
    'SQRT',
    'POWER',
    'PRODUCT',
    'RAND',
    'RANDBETWEEN',
    'COUNTBLANK',
    'COUNTIF',
    'SUMIF',
    'COUNTIFS',
    'SUMIFS',
    'PI',
    'SIGN',
    'EVEN',
    'ODD',
    'EXP',
    'LN',
    'LOG',
    'SIN',
    'COS',
    'TAN',
    'ASIN',
    'ACOS',
    'ATAN',
    'ATAN2',
    'DEGREES',
    'RADIANS',
    'CEILING',
    'FLOOR',
    'TRUNC',
    'MROUND',
    'SUMPRODUCT',
    'GCD',
    'LCM',
    'COMBIN',
    'FACT',
    'QUOTIENT',
    'SUMSQ',
    'ISEVEN',
    'ISODD',
    'FACTDOUBLE',
    'BASE',
    'DECIMAL',
    'SQRTPI',
    'SINH',
    'COSH',
    'TANH',
    'ASINH',
    'ACOSH',
    'ATANH',
    'COT',
    'CSC',
    'SEC',
  ]),
  Statistical: new Set([
    'AVERAGE',
    'MIN',
    'MAX',
    'COUNT',
    'COUNTA',
    'MEDIAN',
    'AVERAGEIF',
    'AVERAGEIFS',
    'LARGE',
    'SMALL',
    'MINIFS',
    'MAXIFS',
    'RANK',
    'PERCENTILE',
    'STDEV',
    'STDEVP',
    'VAR',
    'VARP',
    'MODE',
    'QUARTILE',
    'COUNTUNIQUE',
    'FORECAST',
    'SLOPE',
    'INTERCEPT',
    'CORREL',
    'GEOMEAN',
    'HARMEAN',
    'AVEDEV',
    'DEVSQ',
    'TRIMMEAN',
    'PERMUT',
  ]),
  Text: new Set([
    'TRIM',
    'LEN',
    'LEFT',
    'RIGHT',
    'MID',
    'CONCATENATE',
    'CONCAT',
    'FIND',
    'SEARCH',
    'TEXTJOIN',
    'LOWER',
    'UPPER',
    'PROPER',
    'SUBSTITUTE',
    'EXACT',
    'REPLACE',
    'REPT',
    'T',
    'VALUE',
    'TEXT',
    'CHAR',
    'CODE',
    'CLEAN',
    'NUMBERVALUE',
    'FIXED',
    'DOLLAR',
    'SPLIT',
    'JOIN',
    'REGEXMATCH',
    'REGEXEXTRACT',
    'REGEXREPLACE',
    'UNICODE',
    'UNICHAR',
  ]),
};

function resolveFunctionCategory(name: string): FunctionCategory {
  for (const category of SheetsFunctionCategoryOrder) {
    if (FunctionNamesByCategory[category]?.has(name)) {
      return category;
    }
  }

  throw new Error(`Missing Sheets category for function: ${name}`);
}

export const FunctionCatalog: FunctionInfo[] = FunctionCatalogEntries.map((info) => ({
  ...info,
  category: resolveFunctionCategory(info.name),
}));

/**
 * Lists categories in display order for the provided function set.
 */
export function listFunctionCategories(
  functions: readonly FunctionInfo[] = FunctionCatalog,
): FunctionCategory[] {
  const categories = new Set(functions.map((info) => info.category));
  return SheetsFunctionCategoryOrder.filter((category) =>
    categories.has(category),
  );
}

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
