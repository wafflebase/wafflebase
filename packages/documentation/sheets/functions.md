---
title: Function reference
description: Every function you can use in a Sheets formula, grouped by category, with its syntax and a short description.
type: reference
---

# Function reference

Every function you can use in a Sheets formula, grouped by category, with its syntax and a short description.

**Conventions.** Arguments in square brackets, such as `[if_not_found]`, are optional. `, ...` means you can repeat the argument. Function names are not case-sensitive.

**In the app.** Click **Functions** in the toolbar to search this list and insert a function into a cell. On a phone, it is in the ⋮ (**More formatting options**) menu. For how to enter formulas, see [Formulas](/sheets/formulas).

| Category | Covers |
|---|---|
| [Date](#date) | Dates, times, and working days |
| [Engineering](#engineering) | Number bases, bitwise operations, and complex numbers |
| [Financial](#financial) | Loans, investments, depreciation, and securities |
| [Info](#info) | Checking the type of a value or cell |
| [Logical](#logical) | Conditions and branching |
| [Lookup](#lookup) | Finding values and reshaping ranges |
| [Math](#math) | Arithmetic, rounding, and trigonometry |
| [Operator](#operator) | Function forms of operators such as `+`, `=`, and `&` |
| [Statistical](#statistical) | Averages, counts, distributions, and tests |
| [Text](#text) | Joining, splitting, searching, and changing text |
| [Database](#database) | Calculations over a table that match criteria |

::: info
`FILTER`, `UNIQUE`, `SEQUENCE`, `SORTBY`, `VSTACK`, `TAKE`, `DROP`, `TOCOL`, `FLATTEN`, and `SPLIT` return only their first value, not a whole range. See [Return several values at once](/sheets/formulas#return-several-values-at-once).
:::

## Date

| Function | Syntax | Description |
|---|---|---|
| `TODAY` | `TODAY()` | Returns the current date |
| `NOW` | `NOW()` | Returns the current date and time |
| `DATE` | `DATE(year, month, day)` | Returns a date from year, month, and day values |
| `TIME` | `TIME(hour, minute, second)` | Returns a time from hour, minute, and second values |
| `DAYS` | `DAYS(end_date, start_date)` | Returns the number of days between two dates |
| `YEAR` | `YEAR(date)` | Returns the year from a date |
| `MONTH` | `MONTH(date)` | Returns the month from a date (1-12) |
| `DAY` | `DAY(date)` | Returns the day of the month from a date (1-31) |
| `HOUR` | `HOUR(time)` | Returns the hour from a date/time (0-23) |
| `MINUTE` | `MINUTE(time)` | Returns the minute from a date/time (0-59) |
| `SECOND` | `SECOND(time)` | Returns the second from a date/time (0-59) |
| `WEEKDAY` | `WEEKDAY(date, [type])` | Returns day of the week as a number |
| `EDATE` | `EDATE(start_date, months)` | Returns a date a specified number of months before or after another date |
| `EOMONTH` | `EOMONTH(start_date, months)` | Returns the last day of the month a specified number of months away |
| `NETWORKDAYS` | `NETWORKDAYS(start_date, end_date, [holidays])` | Returns the number of net working days between two dates |
| `DATEVALUE` | `DATEVALUE(date_string)` | Converts a date string to a date value |
| `TIMEVALUE` | `TIMEVALUE(time_string)` | Returns the fraction of the day a time represents |
| `DATEDIF` | `DATEDIF(start_date, end_date, unit)` | Calculates the number of days, months, or years between two dates |
| `WEEKNUM` | `WEEKNUM(date, [type])` | Returns the week number of the year |
| `ISOWEEKNUM` | `ISOWEEKNUM(date)` | Returns the ISO week number of the year |
| `WORKDAY` | `WORKDAY(start_date, days, [holidays])` | Returns a date that is a specified number of working days away |
| `YEARFRAC` | `YEARFRAC(start_date, end_date, [basis])` | Returns the fraction of the year between two dates |
| `DAYS360` | `DAYS360(start_date, end_date, [method])` | Returns the number of days between two dates using 360-day year |
| `WORKDAY.INTL` | `WORKDAY.INTL(start_date, days, [weekend], [holidays])` | Returns a date that is a specified number of workdays with custom weekends |
| `NETWORKDAYS.INTL` | `NETWORKDAYS.INTL(start_date, end_date, [weekend], [holidays])` | Returns the number of working days between two dates with custom weekends |

## Engineering

| Function | Syntax | Description |
|---|---|---|
| `DELTA` | `DELTA(number1, [number2])` | Tests whether two values are equal |
| `GESTEP` | `GESTEP(number, [step])` | Tests whether a number is greater than or equal to a step value |
| `ERF` | `ERF(lower_limit, [upper_limit])` | Returns the error function |
| `ERFC` | `ERFC(x)` | Returns the complementary error function |
| `CONVERT` | `CONVERT(number, from_unit, to_unit)` | Converts a number from one measurement unit to another |
| `BITAND` | `BITAND(number1, number2)` | Returns the bitwise AND of two numbers |
| `BITOR` | `BITOR(number1, number2)` | Returns the bitwise OR of two numbers |
| `BITXOR` | `BITXOR(number1, number2)` | Returns the bitwise XOR of two numbers |
| `BITLSHIFT` | `BITLSHIFT(number, shift_amount)` | Shifts a number left by a specified number of bits |
| `BITRSHIFT` | `BITRSHIFT(number, shift_amount)` | Shifts a number right by a specified number of bits |
| `HEX2DEC` | `HEX2DEC(hex_string)` | Converts a hexadecimal number to decimal |
| `DEC2HEX` | `DEC2HEX(number, [places])` | Converts a decimal number to hexadecimal |
| `BIN2DEC` | `BIN2DEC(bin_string)` | Converts a binary number to decimal |
| `DEC2BIN` | `DEC2BIN(number, [places])` | Converts a decimal number to binary |
| `OCT2DEC` | `OCT2DEC(oct_string)` | Converts an octal number to decimal |
| `DEC2OCT` | `DEC2OCT(number, [places])` | Converts a decimal number to octal |
| `COMPLEX` | `COMPLEX(real, imaginary, [suffix])` | Creates a complex number from real and imaginary parts |
| `IMREAL` | `IMREAL(complex_number)` | Returns the real part of a complex number |
| `IMAGINARY` | `IMAGINARY(complex_number)` | Returns the imaginary part of a complex number |
| `IMABS` | `IMABS(complex_number)` | Returns the absolute value (modulus) of a complex number |
| `IMSUM` | `IMSUM(complex1, [complex2, ...])` | Returns the sum of complex numbers |
| `IMSUB` | `IMSUB(complex1, complex2)` | Returns the difference of two complex numbers |
| `IMPRODUCT` | `IMPRODUCT(complex1, [complex2, ...])` | Returns the product of complex numbers |
| `IMDIV` | `IMDIV(complex1, complex2)` | Returns the quotient of two complex numbers |
| `IMCONJUGATE` | `IMCONJUGATE(complex_number)` | Returns the complex conjugate of a complex number |
| `IMARGUMENT` | `IMARGUMENT(complex_number)` | Returns the argument (angle) of a complex number in radians |
| `IMPOWER` | `IMPOWER(complex_number, power)` | Returns a complex number raised to a power |
| `IMSQRT` | `IMSQRT(complex_number)` | Returns the square root of a complex number |
| `IMEXP` | `IMEXP(complex_number)` | Returns e raised to a complex power |
| `IMLN` | `IMLN(complex_number)` | Returns the natural logarithm of a complex number |
| `IMLOG2` | `IMLOG2(complex_number)` | Returns the base-2 logarithm of a complex number |
| `IMLOG10` | `IMLOG10(complex_number)` | Returns the base-10 logarithm of a complex number |
| `IMSIN` | `IMSIN(complex_number)` | Returns the sine of a complex number |
| `IMCOS` | `IMCOS(complex_number)` | Returns the cosine of a complex number |
| `IMTAN` | `IMTAN(complex_number)` | Returns the tangent of a complex number |
| `IMSINH` | `IMSINH(complex_number)` | Returns the hyperbolic sine of a complex number |
| `IMCOSH` | `IMCOSH(complex_number)` | Returns the hyperbolic cosine of a complex number |
| `IMSEC` | `IMSEC(complex_number)` | Returns the secant of a complex number |
| `IMCSC` | `IMCSC(complex_number)` | Returns the cosecant of a complex number |
| `IMCOT` | `IMCOT(complex_number)` | Returns the cotangent of a complex number |
| `HEX2BIN` | `HEX2BIN(hex_string, [places])` | Converts a hexadecimal number to binary |
| `HEX2OCT` | `HEX2OCT(hex_string, [places])` | Converts a hexadecimal number to octal |
| `BIN2HEX` | `BIN2HEX(bin_string, [places])` | Converts a binary number to hexadecimal |
| `BIN2OCT` | `BIN2OCT(bin_string, [places])` | Converts a binary number to octal |
| `OCT2HEX` | `OCT2HEX(oct_string, [places])` | Converts an octal number to hexadecimal |
| `OCT2BIN` | `OCT2BIN(oct_string, [places])` | Converts an octal number to binary |
| `BESSELJ` | `BESSELJ(x, n)` | Returns the Bessel function of the first kind Jn(x) |
| `BESSELY` | `BESSELY(x, n)` | Returns the Bessel function of the second kind Yn(x) |
| `BESSELI` | `BESSELI(x, n)` | Returns the modified Bessel function of the first kind In(x) |
| `BESSELK` | `BESSELK(x, n)` | Returns the modified Bessel function of the second kind Kn(x) |

## Financial

| Function | Syntax | Description |
|---|---|---|
| `PMT` | `PMT(rate, nper, pv, [fv], [type])` | Returns the periodic payment for an annuity |
| `FV` | `FV(rate, nper, pmt, [pv], [type])` | Returns the future value of an investment |
| `PV` | `PV(rate, nper, pmt, [fv], [type])` | Returns the present value of an investment |
| `NPV` | `NPV(rate, value1, [value2, ...])` | Returns the net present value of an investment |
| `NPER` | `NPER(rate, pmt, pv, [fv], [type])` | Returns the number of periods for an investment |
| `IPMT` | `IPMT(rate, period, nper, pv, [fv], [type])` | Returns the interest portion of a payment |
| `PPMT` | `PPMT(rate, period, nper, pv, [fv], [type])` | Returns the principal portion of a payment |
| `SLN` | `SLN(cost, salvage, life)` | Returns the straight-line depreciation of an asset |
| `EFFECT` | `EFFECT(nominal_rate, periods_per_year)` | Returns the effective annual interest rate |
| `RATE` | `RATE(nper, pmt, pv, [fv], [type], [guess])` | Returns the interest rate per period of an annuity |
| `IRR` | `IRR(values, [guess])` | Returns the internal rate of return for a series of cash flows |
| `DB` | `DB(cost, salvage, life, period, [month])` | Returns the depreciation using the fixed-declining balance method |
| `DDB` | `DDB(cost, salvage, life, period, [factor])` | Returns the depreciation using the double-declining balance method |
| `NOMINAL` | `NOMINAL(effective_rate, periods_per_year)` | Returns the nominal annual interest rate |
| `CUMIPMT` | `CUMIPMT(rate, nper, pv, start_period, end_period, type)` | Returns the cumulative interest paid between two periods |
| `CUMPRINC` | `CUMPRINC(rate, nper, pv, start_period, end_period, type)` | Returns the cumulative principal paid between two periods |
| `XNPV` | `XNPV(rate, values, dates)` | Returns net present value for irregular cash flows |
| `XIRR` | `XIRR(values, dates, [guess])` | Returns internal rate of return for irregular cash flows |
| `SYD` | `SYD(cost, salvage, life, period)` | Returns the sum-of-years-digits depreciation |
| `MIRR` | `MIRR(values, finance_rate, reinvest_rate)` | Returns the modified internal rate of return |
| `TBILLEQ` | `TBILLEQ(settlement, maturity, discount)` | Returns the bond-equivalent yield for a T-bill |
| `TBILLPRICE` | `TBILLPRICE(settlement, maturity, discount)` | Returns the price per $100 for a T-bill |
| `TBILLYIELD` | `TBILLYIELD(settlement, maturity, price)` | Returns the yield for a T-bill |
| `DOLLARDE` | `DOLLARDE(fractional_dollar, fraction)` | Converts a fractional dollar price to a decimal price |
| `DOLLARFR` | `DOLLARFR(decimal_dollar, fraction)` | Converts a decimal dollar price to a fractional price |
| `ACCRINT` | `ACCRINT(issue, first_interest, settlement, rate, par, frequency, [basis])` | Returns the accrued interest for a security that pays periodic interest |
| `ACCRINTM` | `ACCRINTM(issue, settlement, rate, par, [basis])` | Returns the accrued interest for a security that pays at maturity |
| `COUPDAYBS` | `COUPDAYBS(settlement, maturity, frequency, [basis])` | Returns the number of days from the coupon period start to settlement |
| `COUPDAYS` | `COUPDAYS(settlement, maturity, frequency, [basis])` | Returns the number of days in the coupon period containing settlement |
| `COUPDAYSNC` | `COUPDAYSNC(settlement, maturity, frequency, [basis])` | Returns the number of days from settlement to the next coupon date |
| `COUPNCD` | `COUPNCD(settlement, maturity, frequency, [basis])` | Returns the next coupon date after settlement |
| `COUPNUM` | `COUPNUM(settlement, maturity, frequency, [basis])` | Returns the number of coupons between settlement and maturity |
| `COUPPCD` | `COUPPCD(settlement, maturity, frequency, [basis])` | Returns the previous coupon date before settlement |
| `DISC` | `DISC(settlement, maturity, price, redemption, [basis])` | Returns the discount rate for a security |
| `PRICEDISC` | `PRICEDISC(settlement, maturity, discount, redemption, [basis])` | Returns the price of a discounted security |
| `YIELDDISC` | `YIELDDISC(settlement, maturity, price, redemption, [basis])` | Returns the annual yield for a discounted security |
| `DURATION` | `DURATION(settlement, maturity, coupon, yield, frequency, [basis])` | Returns the Macaulay duration of a security |
| `MDURATION` | `MDURATION(settlement, maturity, coupon, yield, frequency, [basis])` | Returns the modified Macaulay duration of a security |
| `RECEIVED` | `RECEIVED(settlement, maturity, investment, discount, [basis])` | Returns the amount received at maturity for a fully invested security |
| `INTRATE` | `INTRATE(settlement, maturity, investment, redemption, [basis])` | Returns the interest rate for a fully invested security |
| `PRICE` | `PRICE(settlement, maturity, rate, yield, redemption, frequency, [basis])` | Returns the price per $100 face value of a coupon-paying security |
| `YIELD` | `YIELD(settlement, maturity, rate, price, redemption, frequency, [basis])` | Returns the yield on a coupon-paying security |
| `PRICEMAT` | `PRICEMAT(settlement, maturity, issue, rate, yield, [basis])` | Returns the price of a security that pays at maturity |
| `YIELDMAT` | `YIELDMAT(settlement, maturity, issue, rate, price, [basis])` | Returns the yield of a security that pays at maturity |
| `AMORLINC` | `AMORLINC(cost, purchase_date, first_period, salvage, period, rate, [basis])` | Returns the depreciation for each accounting period (French linear) |
| `ISPMT` | `ISPMT(rate, period, nper, pv)` | Returns the interest paid during a specific period of a loan |
| `FVSCHEDULE` | `FVSCHEDULE(principal, schedule)` | Returns the future value of a principal after applying a schedule of rates |
| `PDURATION` | `PDURATION(rate, pv, fv)` | Returns the number of periods for an investment to reach a specified value |
| `RRI` | `RRI(nper, pv, fv)` | Returns the equivalent interest rate for the growth of an investment |

## Info

| Function | Syntax | Description |
|---|---|---|
| `ISBLANK` | `ISBLANK(value)` | Checks whether a value is blank |
| `ISNUMBER` | `ISNUMBER(value)` | Checks whether a value is a number |
| `ISTEXT` | `ISTEXT(value)` | Checks whether a value is text |
| `ISERROR` | `ISERROR(value)` | Checks whether a value is any error |
| `ISERR` | `ISERR(value)` | Checks whether a value is an error except #N/A |
| `ISNA` | `ISNA(value)` | Checks whether a value is the #N/A error |
| `ISLOGICAL` | `ISLOGICAL(value)` | Checks whether a value is boolean |
| `ISNONTEXT` | `ISNONTEXT(value)` | Checks whether a value is not text |
| `N` | `N(value)` | Converts a value to a number |
| `TYPE` | `TYPE(value)` | Returns a number indicating the data type of a value |
| `NA` | `NA()` | Returns the #N/A error value |
| `ERROR.TYPE` | `ERROR.TYPE(value)` | Returns a number corresponding to the error type |
| `ISDATE` | `ISDATE(value)` | Checks whether a value is a date |
| `ISURL` | `ISURL(value)` | Returns TRUE if a value is a valid URL |
| `ISFORMULA` | `ISFORMULA(cell)` | Returns TRUE if a cell contains a formula |
| `FORMULATEXT` | `FORMULATEXT(cell)` | Returns the formula of a cell as a string |
| `ISREF` | `ISREF(value)` | Returns TRUE if the value is a reference |
| `SHEET` | `SHEET([value])` | Returns the sheet number of a reference |
| `SHEETS` | `SHEETS([reference])` | Returns the number of sheets in a reference |
| `AREAS` | `AREAS(reference)` | Returns the number of areas in a reference |
| `CELL` | `CELL(info_type, [reference])` | Returns information about a cell |

## Logical

| Function | Syntax | Description |
|---|---|---|
| `IF` | `IF(condition, value_if_true, [value_if_false])` | Returns one value if true and another if false |
| `IFS` | `IFS(condition1, value1, [condition2, ...], [value2, ...])` | Returns the first value whose condition is true |
| `SWITCH` | `SWITCH(expression, case1, value1, [case2_or_default, ...], [value2, ...])` | Matches an expression against case/value pairs |
| `AND` | `AND(logical1, [logical2, ...])` | Returns TRUE if all arguments are true |
| `OR` | `OR(logical1, [logical2, ...])` | Returns TRUE if any argument is true |
| `NOT` | `NOT(logical)` | Returns the opposite of a logical value |
| `TRUE` | `TRUE()` | Returns the boolean value TRUE |
| `FALSE` | `FALSE()` | Returns the boolean value FALSE |
| `IFERROR` | `IFERROR(value, value_if_error)` | Returns a value if no error, otherwise returns an alternate value |
| `IFNA` | `IFNA(value, value_if_na)` | Returns a value if no #N/A error, otherwise returns an alternate value |
| `XOR` | `XOR(logical1, [logical2, ...])` | Returns TRUE if an odd number of arguments are TRUE |
| `CHOOSE` | `CHOOSE(index, value1, [value2, ...])` | Returns a value from a list based on index |

## Lookup

| Function | Syntax | Description |
|---|---|---|
| `MATCH` | `MATCH(search_key, range, [search_type])` | Returns the position of an item in a one-dimensional range |
| `INDEX` | `INDEX(reference, [row], [column])` | Returns the value at a given row and column of a range |
| `VLOOKUP` | `VLOOKUP(search_key, range, index, [is_sorted])` | Looks up a value in the first column of a range |
| `HLOOKUP` | `HLOOKUP(search_key, range, index, [is_sorted])` | Looks up a value in the first row of a range |
| `ROW` | `ROW([reference])` | Returns the row number of a reference |
| `COLUMN` | `COLUMN([reference])` | Returns the column number of a reference |
| `ROWS` | `ROWS(range)` | Returns the number of rows in a range |
| `COLUMNS` | `COLUMNS(range)` | Returns the number of columns in a range |
| `ADDRESS` | `ADDRESS(row, column, [abs_num], [a1])` | Returns a cell reference as text given row and column numbers |
| `HYPERLINK` | `HYPERLINK(url, [link_label])` | Creates a hyperlink in a cell |
| `LOOKUP` | `LOOKUP(search_key, search_range, [result_range])` | Searches a sorted range for a key |
| `INDIRECT` | `INDIRECT(cell_reference, [is_A1_notation])` | Returns the reference specified by a text string |
| `XLOOKUP` | `XLOOKUP(search_key, lookup_range, return_range, [if_not_found], [match_mode], [search_mode])` | Searches a range for a match and returns a corresponding item |
| `OFFSET` | `OFFSET(reference, rows, cols, [height], [width])` | Returns a reference offset from a starting reference |
| `SORT` | `SORT(range, [sort_index], [sort_order])` | Sorts a range of data |
| `FLATTEN` | `FLATTEN(range)` | Flattens a range into a single column |
| `TRANSPOSE` | `TRANSPOSE(range)` | Transposes the rows and columns of a range |
| `XMATCH` | `XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])` | Returns the relative position of a value in an array |
| `TOCOL` | `TOCOL(array, [ignore], [scan_by_column])` | Transforms an array into a single column |
| `TOROW` | `TOROW(array, [ignore], [scan_by_column])` | Transforms an array into a single row |
| `CHOOSEROWS` | `CHOOSEROWS(array, row_num1, [row_num2])` | Returns specified rows from an array |
| `CHOOSECOLS` | `CHOOSECOLS(array, col_num1, [col_num2, ...])` | Returns specified columns from an array |
| `TAKE` | `TAKE(array, rows, [columns])` | Returns rows or columns from the start or end of an array |
| `DROP` | `DROP(array, rows, [columns])` | Removes rows or columns from the start or end of an array |
| `HSTACK` | `HSTACK(range1, [range2, ...])` | Appends arrays horizontally |
| `VSTACK` | `VSTACK(range1, [range2])` | Appends arrays vertically |
| `SORTBY` | `SORTBY(array, by_array, [sort_order])` | Sorts a range by another range |
| `WRAPCOLS` | `WRAPCOLS(vector, wrap_count, [pad_with])` | Wraps a row or column of values into columns |
| `WRAPROWS` | `WRAPROWS(vector, wrap_count, [pad_with])` | Wraps a row or column of values into rows |
| `FILTER` | `FILTER(array, include, [if_empty])` | Filters an array based on a boolean array |
| `EXPAND` | `EXPAND(array, rows, [columns], [pad_with])` | Expands an array to specified dimensions |

## Math

| Function | Syntax | Description |
|---|---|---|
| `SUM` | `SUM(number1, [number2, ...])` | Returns the sum of a series of numbers |
| `ABS` | `ABS(number)` | Returns the absolute value of a number |
| `ROUND` | `ROUND(value, [places])` | Rounds a number to a certain number of decimal places |
| `ROUNDUP` | `ROUNDUP(value, [places])` | Rounds a number away from zero |
| `ROUNDDOWN` | `ROUNDDOWN(value, [places])` | Rounds a number toward zero |
| `INT` | `INT(value)` | Rounds a number down to the nearest integer |
| `MOD` | `MOD(dividend, divisor)` | Returns the remainder after division |
| `SQRT` | `SQRT(value)` | Returns the positive square root of a number |
| `POWER` | `POWER(base, exponent)` | Returns a number raised to a power |
| `PRODUCT` | `PRODUCT(number1, [number2, ...])` | Multiplies a series of numbers |
| `RAND` | `RAND()` | Returns a random number between 0 and 1 |
| `RANDBETWEEN` | `RANDBETWEEN(low, high)` | Returns a random integer between two values |
| `COUNTBLANK` | `COUNTBLANK(value1, [value2, ...])` | Counts empty cells |
| `COUNTIF` | `COUNTIF(range, criterion)` | Counts values in a range that meet a criterion |
| `SUMIF` | `SUMIF(range, criterion, [sum_range])` | Sums values in a range that meet a criterion |
| `COUNTIFS` | `COUNTIFS(criteria_range1, criterion1, [criteria_range2, ...], [criterion2, ...])` | Counts values that meet multiple criteria |
| `SUMIFS` | `SUMIFS(sum_range, criteria_range1, criterion1, [criteria_range2, ...], [criterion2, ...])` | Sums values that meet multiple criteria |
| `PI` | `PI()` | Returns the value of Pi |
| `SIGN` | `SIGN(number)` | Returns the sign of a number (-1, 0, or 1) |
| `EVEN` | `EVEN(number)` | Rounds a number up to the nearest even integer |
| `ODD` | `ODD(number)` | Rounds a number up to the nearest odd integer |
| `EXP` | `EXP(exponent)` | Returns Euler's number raised to a power |
| `LN` | `LN(number)` | Returns the natural logarithm of a number |
| `LOG` | `LOG(number, [base])` | Returns the logarithm of a number given a base |
| `SIN` | `SIN(angle)` | Returns the sine of an angle in radians |
| `COS` | `COS(angle)` | Returns the cosine of an angle in radians |
| `TAN` | `TAN(angle)` | Returns the tangent of an angle in radians |
| `ASIN` | `ASIN(value)` | Returns the inverse sine of a value in radians |
| `ACOS` | `ACOS(value)` | Returns the inverse cosine of a value in radians |
| `ATAN` | `ATAN(value)` | Returns the inverse tangent of a value in radians |
| `ATAN2` | `ATAN2(x, y)` | Returns the angle between the x-axis and a point |
| `DEGREES` | `DEGREES(angle)` | Converts an angle from radians to degrees |
| `RADIANS` | `RADIANS(angle)` | Converts an angle from degrees to radians |
| `CEILING` | `CEILING(number, [significance])` | Rounds a number up to the nearest multiple of significance |
| `FLOOR` | `FLOOR(number, [significance])` | Rounds a number down to the nearest multiple of significance |
| `TRUNC` | `TRUNC(number, [places])` | Truncates a number to a given number of decimal places |
| `MROUND` | `MROUND(number, multiple)` | Rounds a number to the nearest specified multiple |
| `SUMPRODUCT` | `SUMPRODUCT(array1, [array2, ...])` | Multiplies corresponding components and returns the sum |
| `GCD` | `GCD(number1, [number2, ...])` | Returns the greatest common divisor |
| `LCM` | `LCM(number1, [number2, ...])` | Returns the least common multiple |
| `COMBIN` | `COMBIN(n, k)` | Returns the number of combinations for a given number of items |
| `FACT` | `FACT(number)` | Returns the factorial of a number |
| `QUOTIENT` | `QUOTIENT(numerator, denominator)` | Returns the integer portion of a division |
| `SUMSQ` | `SUMSQ(number1, [number2, ...])` | Returns the sum of the squares of the arguments |
| `ISEVEN` | `ISEVEN(number)` | Checks whether a number is even |
| `ISODD` | `ISODD(number)` | Checks whether a number is odd |
| `FACTDOUBLE` | `FACTDOUBLE(number)` | Returns the double factorial of a number |
| `BASE` | `BASE(number, base, [min_length])` | Converts a number to text in another base |
| `DECIMAL` | `DECIMAL(text, base)` | Converts text from another base to a decimal number |
| `SQRTPI` | `SQRTPI(number)` | Returns the square root of number * PI |
| `SINH` | `SINH(number)` | Returns the hyperbolic sine of a number |
| `COSH` | `COSH(number)` | Returns the hyperbolic cosine of a number |
| `TANH` | `TANH(number)` | Returns the hyperbolic tangent of a number |
| `ASINH` | `ASINH(number)` | Returns the inverse hyperbolic sine of a number |
| `ACOSH` | `ACOSH(number)` | Returns the inverse hyperbolic cosine of a number |
| `ATANH` | `ATANH(number)` | Returns the inverse hyperbolic tangent of a number |
| `COT` | `COT(angle)` | Returns the cotangent of an angle in radians |
| `CSC` | `CSC(angle)` | Returns the cosecant of an angle in radians |
| `SEC` | `SEC(angle)` | Returns the secant of an angle in radians |
| `ARABIC` | `ARABIC(roman_numeral)` | Converts a Roman numeral to a number |
| `ROMAN` | `ROMAN(number, [form])` | Converts a number to Roman numeral text |
| `MULTINOMIAL` | `MULTINOMIAL(number1, [number2, ...])` | Returns the multinomial coefficient |
| `SERIESSUM` | `SERIESSUM(x, n, m, coefficients)` | Returns the sum of a power series |
| `CEILING.MATH` | `CEILING.MATH(number, [significance], [mode])` | Rounds a number up to the nearest integer or multiple of significance |
| `FLOOR.MATH` | `FLOOR.MATH(number, [significance], [mode])` | Rounds a number down to the nearest integer or multiple of significance |
| `CEILING.PRECISE` | `CEILING.PRECISE(number, [significance])` | Rounds a number up to the nearest multiple of significance, ignoring sign |
| `FLOOR.PRECISE` | `FLOOR.PRECISE(number, [significance])` | Rounds a number down to the nearest multiple of significance, ignoring sign |
| `SUMX2MY2` | `SUMX2MY2(array_x, array_y)` | Returns the sum of differences of squares of corresponding values |
| `SUMX2PY2` | `SUMX2PY2(array_x, array_y)` | Returns the sum of sums of squares of corresponding values |
| `SUMXMY2` | `SUMXMY2(array_x, array_y)` | Returns the sum of squares of differences of corresponding values |
| `SEQUENCE` | `SEQUENCE(rows, [columns], [start], [step])` | Generates a sequence of numbers |
| `RANDARRAY` | `RANDARRAY([rows], [columns], [min], [max], [whole_number])` | Generates an array of random numbers |
| `SUBTOTAL` | `SUBTOTAL(function_num, ref1, [ref2, ...])` | Returns a subtotal using a specified aggregate function |
| `MDETERM` | `MDETERM(square_matrix)` | Returns the determinant of a square matrix |
| `COMBINA` | `COMBINA(n, k)` | Returns the number of combinations with repetition |
| `MMULT` | `MMULT(array1, array2)` | Returns the matrix product of two arrays |
| `MINVERSE` | `MINVERSE(array)` | Returns the inverse matrix of a square array |
| `ISO.CEILING` | `ISO.CEILING(number, [significance])` | Rounds a number up to the nearest integer or multiple of significance |
| `SECH` | `SECH(number)` | Returns the hyperbolic secant of a number |
| `CSCH` | `CSCH(number)` | Returns the hyperbolic cosecant of a number |
| `COTH` | `COTH(number)` | Returns the hyperbolic cotangent of a number |
| `ACOT` | `ACOT(number)` | Returns the arccotangent of a number |
| `ACOTH` | `ACOTH(number)` | Returns the inverse hyperbolic cotangent of a number |
| `MUNIT` | `MUNIT(dimension)` | Returns the identity matrix of the specified dimension |

## Operator

| Function | Syntax | Description |
|---|---|---|
| `CONCAT` | `CONCAT(text1, text2, [text3, ...])` | Joins text values into one string |
| `UNIQUE` | `UNIQUE(range)` | Returns unique values from a range |
| `ADD` | `ADD(value1, value2)` | Returns the sum of two numbers |
| `MINUS` | `MINUS(value1, value2)` | Returns the difference of two numbers |
| `MULTIPLY` | `MULTIPLY(factor1, factor2)` | Returns the product of two numbers |
| `DIVIDE` | `DIVIDE(dividend, divisor)` | Returns the result of dividing one number by another |
| `POW` | `POW(base, exponent)` | Returns the result of raising a number to a power |
| `UMINUS` | `UMINUS(value)` | Returns the negation of a number |
| `UPLUS` | `UPLUS(value)` | Returns the unary positive of a number |
| `UNARY_PERCENT` | `UNARY_PERCENT(percentage)` | Returns a value interpreted as a percentage |
| `EQ` | `EQ(value1, value2)` | Returns TRUE if two values are equal |
| `NE` | `NE(value1, value2)` | Returns TRUE if two values are not equal |
| `LT` | `LT(value1, value2)` | Returns TRUE if the first value is less than the second |
| `LTE` | `LTE(value1, value2)` | Returns TRUE if the first value is less than or equal to the second |
| `GT` | `GT(value1, value2)` | Returns TRUE if the first value is greater than the second |
| `GTE` | `GTE(value1, value2)` | Returns TRUE if the first value is greater than or equal to the second |
| `ISBETWEEN` | `ISBETWEEN(value_to_compare, lower_value, upper_value, [lower_value_is_inclusive], [upper_value_is_inclusive])` | Returns TRUE if a value is between two values (inclusive by default) |

## Statistical

| Function | Syntax | Description |
|---|---|---|
| `MEDIAN` | `MEDIAN(number1, [number2, ...])` | Returns the middle number in a series |
| `AVERAGE` | `AVERAGE(number1, [number2, ...])` | Returns the average of a series of numbers |
| `MIN` | `MIN(number1, [number2, ...])` | Returns the smallest value in a set of numbers |
| `MAX` | `MAX(number1, [number2, ...])` | Returns the largest value in a set of numbers |
| `COUNT` | `COUNT(value1, [value2, ...])` | Counts the number of numeric values |
| `COUNTA` | `COUNTA(value1, [value2, ...])` | Counts the number of non-empty values |
| `AVERAGEIF` | `AVERAGEIF(criteria_range, criterion, [average_range])` | Returns the average of a range that meets a criterion |
| `AVERAGEIFS` | `AVERAGEIFS(average_range, criteria_range1, criterion1, [criteria_range2, ...], [criterion2, ...])` | Returns the average of a range that meets multiple criteria |
| `LARGE` | `LARGE(data, n)` | Returns the nth largest value in a data set |
| `SMALL` | `SMALL(data, n)` | Returns the nth smallest value in a data set |
| `MINIFS` | `MINIFS(min_range, criteria_range1, criterion1, [criteria_range2, ...], [criterion2, ...])` | Returns the minimum value in a range that meets multiple criteria |
| `MAXIFS` | `MAXIFS(max_range, criteria_range1, criterion1, [criteria_range2, ...], [criterion2, ...])` | Returns the maximum value in a range that meets multiple criteria |
| `RANK` | `RANK(value, data, [order])` | Returns the rank of a value within a data set |
| `PERCENTILE` | `PERCENTILE(data, k)` | Returns the k-th percentile of a data set |
| `STDEV` | `STDEV(number1, [number2, ...])` | Returns the sample standard deviation |
| `STDEVP` | `STDEVP(number1, [number2, ...])` | Returns the population standard deviation |
| `VAR` | `VAR(number1, [number2, ...])` | Returns the sample variance |
| `VARP` | `VARP(number1, [number2, ...])` | Returns the population variance |
| `MODE` | `MODE(number1, [number2, ...])` | Returns the most frequently occurring value |
| `QUARTILE` | `QUARTILE(data, quart)` | Returns the quartile of a data set |
| `COUNTUNIQUE` | `COUNTUNIQUE(value1, [value2, ...])` | Counts the number of unique values in a list |
| `FORECAST` | `FORECAST(x, known_ys, known_xs)` | Predicts a y-value for a given x using linear regression |
| `SLOPE` | `SLOPE(known_ys, known_xs)` | Returns the slope of the linear regression line |
| `INTERCEPT` | `INTERCEPT(known_ys, known_xs)` | Returns the y-intercept of the linear regression line |
| `CORREL` | `CORREL(data_y, data_x)` | Returns the Pearson correlation coefficient |
| `GEOMEAN` | `GEOMEAN(number1, [number2, ...])` | Returns the geometric mean |
| `HARMEAN` | `HARMEAN(number1, [number2, ...])` | Returns the harmonic mean |
| `AVEDEV` | `AVEDEV(number1, [number2, ...])` | Returns the average absolute deviation from the mean |
| `DEVSQ` | `DEVSQ(number1, [number2, ...])` | Returns the sum of squared deviations from the mean |
| `TRIMMEAN` | `TRIMMEAN(data, percent)` | Returns the mean of the interior portion of a data set |
| `PERMUT` | `PERMUT(n, k)` | Returns the number of permutations for a given number of objects |
| `AVERAGEA` | `AVERAGEA(value1, [value2, ...])` | Returns the average, including text as 0 and booleans |
| `MINA` | `MINA(value1, [value2, ...])` | Returns the minimum value, including text as 0 and booleans |
| `MAXA` | `MAXA(value1, [value2, ...])` | Returns the maximum value, including text as 0 and booleans |
| `FISHER` | `FISHER(x)` | Returns the Fisher transformation |
| `FISHERINV` | `FISHERINV(y)` | Returns the inverse Fisher transformation |
| `GAMMA` | `GAMMA(number)` | Returns the gamma function value |
| `GAMMALN` | `GAMMALN(number)` | Returns the natural log of the gamma function |
| `NORMDIST` | `NORMDIST(x, mean, stdev, cumulative)` | Returns the normal distribution |
| `NORMINV` | `NORMINV(probability, mean, stdev)` | Returns the inverse of the normal distribution |
| `LOGNORMAL.DIST` | `LOGNORMAL.DIST(x, mean, stdev, cumulative)` | Returns the lognormal distribution |
| `LOGNORMAL.INV` | `LOGNORMAL.INV(probability, mean, stdev)` | Returns the inverse of the lognormal distribution |
| `STANDARDIZE` | `STANDARDIZE(x, mean, stdev)` | Returns a normalized value (z-score) |
| `WEIBULL.DIST` | `WEIBULL.DIST(x, alpha, beta, cumulative)` | Returns the Weibull distribution |
| `POISSON.DIST` | `POISSON.DIST(x, mean, cumulative)` | Returns the Poisson distribution |
| `BINOM.DIST` | `BINOM.DIST(successes, trials, probability, cumulative)` | Returns the binomial distribution probability |
| `EXPON.DIST` | `EXPON.DIST(x, lambda, cumulative)` | Returns the exponential distribution |
| `CONFIDENCE.NORM` | `CONFIDENCE.NORM(alpha, stdev, size)` | Returns the confidence interval using normal distribution |
| `CONFIDENCE.T` | `CONFIDENCE.T(alpha, stdev, size)` | Returns the confidence interval using t-distribution |
| `CHISQ.DIST` | `CHISQ.DIST(x, degrees_freedom, cumulative)` | Returns the chi-squared distribution |
| `CHISQ.INV` | `CHISQ.INV(probability, degrees_freedom)` | Returns the inverse of the chi-squared distribution |
| `T.DIST` | `T.DIST(x, degrees_freedom, cumulative)` | Returns the Student t-distribution |
| `T.INV` | `T.INV(probability, degrees_freedom)` | Returns the inverse of the Student t-distribution |
| `HYPGEOM.DIST` | `HYPGEOM.DIST(sample_s, number_sample, population_s, number_pop, cumulative)` | Returns the hypergeometric distribution |
| `NEGBINOM.DIST` | `NEGBINOM.DIST(failures, successes, probability, cumulative)` | Returns the negative binomial distribution |
| `COVAR` | `COVAR(data_y, data_x)` | Returns the population covariance of two datasets |
| `COVARIANCE.S` | `COVARIANCE.S(data_y, data_x)` | Returns the sample covariance of two datasets |
| `RSQ` | `RSQ(known_ys, known_xs)` | Returns the R-squared value of a linear regression |
| `STEYX` | `STEYX(known_ys, known_xs)` | Returns the standard error of the predicted y-value in a regression |
| `PERCENTILE.EXC` | `PERCENTILE.EXC(data, k)` | Returns the k-th percentile of values using exclusive interpolation |
| `QUARTILE.EXC` | `QUARTILE.EXC(data, quart)` | Returns the exclusive quartile of a dataset |
| `RANK.AVG` | `RANK.AVG(value, data, [is_ascending])` | Returns the rank of a value with average ranking for ties |
| `PERCENTRANK` | `PERCENTRANK(data, x, [significance])` | Returns the percentage rank of a value in a dataset (inclusive) |
| `PERCENTRANK.EXC` | `PERCENTRANK.EXC(data, x, [significance])` | Returns the percentage rank of a value in a dataset (exclusive) |
| `BETA.DIST` | `BETA.DIST(x, alpha, beta, cumulative, [A], [B])` | Returns the beta distribution probability |
| `BETA.INV` | `BETA.INV(probability, alpha, beta, [A], [B])` | Returns the inverse of the beta cumulative distribution |
| `F.DIST` | `F.DIST(x, deg_freedom1, deg_freedom2, cumulative)` | Returns the F probability distribution |
| `F.INV` | `F.INV(probability, deg_freedom1, deg_freedom2)` | Returns the inverse of the F probability distribution |
| `GAMMA.DIST` | `GAMMA.DIST(x, alpha, beta, cumulative)` | Returns the gamma distribution probability |
| `GAMMA.INV` | `GAMMA.INV(probability, alpha, beta)` | Returns the inverse of the gamma cumulative distribution |
| `CHISQ.DIST.RT` | `CHISQ.DIST.RT(x, degrees_freedom)` | Returns the right-tailed chi-squared distribution probability |
| `CHISQ.INV.RT` | `CHISQ.INV.RT(probability, degrees_freedom)` | Returns the inverse right-tailed chi-squared distribution |
| `T.DIST.RT` | `T.DIST.RT(x, degrees_freedom)` | Returns the right-tailed Student t-distribution |
| `T.DIST.2T` | `T.DIST.2T(x, degrees_freedom)` | Returns the two-tailed Student t-distribution |
| `T.INV.2T` | `T.INV.2T(probability, degrees_freedom)` | Returns the inverse two-tailed Student t-distribution |
| `F.DIST.RT` | `F.DIST.RT(x, deg_freedom1, deg_freedom2)` | Returns the right-tailed F probability distribution |
| `F.INV.RT` | `F.INV.RT(probability, deg_freedom1, deg_freedom2)` | Returns the inverse right-tailed F probability distribution |
| `BINOM.INV` | `BINOM.INV(trials, probability_s, alpha)` | Returns the smallest value for which the cumulative binomial distribution is >= alpha |
| `NORM.S.DIST` | `NORM.S.DIST(z, cumulative)` | Returns the standard normal distribution probability |
| `NORM.S.INV` | `NORM.S.INV(probability)` | Returns the inverse of the standard normal distribution |
| `VARA` | `VARA(value1, [value2, ...])` | Returns the sample variance including text and booleans |
| `VARPA` | `VARPA(value1, [value2, ...])` | Returns the population variance including text and booleans |
| `SKEW` | `SKEW(value1, [value2, ...])` | Returns the skewness of a dataset |
| `KURT` | `KURT(value1, [value2, ...])` | Returns the excess kurtosis of a dataset |
| `PROB` | `PROB(x_range, prob_range, lower_limit, [upper_limit])` | Returns the probability of values in a range between two limits |
| `GROWTH` | `GROWTH(known_y, [known_x], [new_x])` | Calculates predicted exponential growth using existing data |
| `TREND` | `TREND(known_y, [known_x], [new_x])` | Calculates predicted linear trend values using least squares regression |
| `LINEST` | `LINEST(known_y, [known_x])` | Returns the slope of the linear regression line |
| `LOGEST` | `LOGEST(known_y, [known_x])` | Returns the growth rate of an exponential regression |
| `FREQUENCY` | `FREQUENCY(data_array, bins_array)` | Calculates how often values occur within a range of bins |
| `MODE.MULT` | `MODE.MULT(number1, [number2, ...])` | Returns the most frequently occurring values in a dataset |
| `AGGREGATE` | `AGGREGATE(function_num, options, ref1, [ref2, ...])` | Returns an aggregate calculation, ignoring errors and hidden rows |
| `PERMUTATIONA` | `PERMUTATIONA(n, k)` | Returns the number of permutations with repetition |
| `T.TEST` | `T.TEST(range1, range2, tails, type)` | Returns the probability associated with a Student t-test |
| `Z.TEST` | `Z.TEST(range, value, [sigma])` | Returns the one-tailed p-value of a z-test |
| `GAUSS` | `GAUSS(z)` | Returns the probability between 0 and z standard deviations |
| `PHI` | `PHI(x)` | Returns the value of the standard normal density function |
| `STDEVA` | `STDEVA(value1, [value2])` | Standard deviation of a sample, including text and logical values |
| `STDEVPA` | `STDEVPA(value1, [value2])` | Standard deviation of a population, including text and logical values |
| `SKEW.P` | `SKEW.P(number1, [number2])` | Returns the population skewness of a distribution |
| `CHISQ.TEST` | `CHISQ.TEST(actual_range, expected_range)` | Returns the chi-squared test for independence |
| `F.TEST` | `F.TEST(array1, array2)` | Returns the result of an F-test |
| `BINOM.DIST.RANGE` | `BINOM.DIST.RANGE(trials, probability_s, number_s, [number_s2])` | Returns the probability of a trial result using a binomial distribution |
| `STDEV.S` | `STDEV.S(number1, [number2, ...])` | Returns the sample standard deviation (alias for STDEV) |
| `STDEV.P` | `STDEV.P(number1, [number2, ...])` | Returns the population standard deviation (alias for STDEVP) |
| `VAR.S` | `VAR.S(number1, [number2, ...])` | Returns the sample variance (alias for VAR) |
| `VAR.P` | `VAR.P(number1, [number2, ...])` | Returns the population variance (alias for VARP) |
| `MODE.SNGL` | `MODE.SNGL(number1, [number2, ...])` | Returns the most frequently occurring value (alias for MODE) |
| `NORM.DIST` | `NORM.DIST(x, mean, stdev, cumulative)` | Returns the normal distribution (alias for NORMDIST) |
| `NORM.INV` | `NORM.INV(probability, mean, stdev)` | Returns the inverse of the normal distribution (alias for NORMINV) |
| `QUARTILE.INC` | `QUARTILE.INC(data, quart)` | Returns the quartile of a data set (alias for QUARTILE) |
| `PERCENTILE.INC` | `PERCENTILE.INC(data, k)` | Returns the k-th percentile of a data set (alias for PERCENTILE) |
| `RANK.EQ` | `RANK.EQ(value, data, [order])` | Returns the rank of a value within a data set (alias for RANK) |
| `PERCENTRANK.INC` | `PERCENTRANK.INC(data, x, [significance])` | Returns the percentage rank of a value in a dataset (alias for PERCENTRANK) |
| `COVARIANCE.P` | `COVARIANCE.P(data_y, data_x)` | Returns the population covariance of two datasets (alias for COVAR) |
| `FORECAST.LINEAR` | `FORECAST.LINEAR(x, known_ys, known_xs)` | Predicts a y-value for a given x using linear regression (alias for FORECAST) |

## Text

| Function | Syntax | Description |
|---|---|---|
| `TRIM` | `TRIM(text)` | Removes leading and trailing whitespace from text |
| `LEN` | `LEN(text)` | Returns the number of characters in a text string |
| `LEFT` | `LEFT(text, [num_chars])` | Returns the leftmost characters from a text string |
| `RIGHT` | `RIGHT(text, [num_chars])` | Returns the rightmost characters from a text string |
| `MID` | `MID(text, start_num, num_chars)` | Returns characters from the middle of a text string |
| `CONCATENATE` | `CONCATENATE(text1, text2, [text3, ...])` | Joins two or more text strings into one |
| `FIND` | `FIND(search_for, text_to_search, [starting_at])` | Finds one text value inside another (case-sensitive) |
| `SEARCH` | `SEARCH(search_for, text_to_search, [starting_at])` | Finds one text value inside another (case-insensitive) |
| `TEXTJOIN` | `TEXTJOIN(delimiter, ignore_empty, text1, [text2, ...])` | Joins text values with a delimiter |
| `LOWER` | `LOWER(text)` | Converts text to lowercase |
| `UPPER` | `UPPER(text)` | Converts text to uppercase |
| `PROPER` | `PROPER(text)` | Capitalizes each word in text |
| `SUBSTITUTE` | `SUBSTITUTE(text, search_for, replace_with, [occurrence])` | Replaces existing text with new text in a string |
| `EXACT` | `EXACT(text1, text2)` | Tests whether two strings are identical (case-sensitive) |
| `REPLACE` | `REPLACE(old_text, start_num, num_chars, new_text)` | Replaces part of a text string with a different text string |
| `REPT` | `REPT(text, number_times)` | Repeats text a given number of times |
| `T` | `T(value)` | Returns the text referred to by value |
| `VALUE` | `VALUE(text)` | Converts a text string that represents a number to a number |
| `TEXT` | `TEXT(number, format)` | Formats a number and converts it to text |
| `CHAR` | `CHAR(number)` | Returns the character specified by the code number |
| `CODE` | `CODE(text)` | Returns a numeric code for the first character in a text string |
| `CLEAN` | `CLEAN(text)` | Removes all non-printable characters from text |
| `NUMBERVALUE` | `NUMBERVALUE(text, [decimal_separator], [group_separator])` | Converts text to a number in a locale-independent way |
| `FIXED` | `FIXED(number, [decimals], [no_commas])` | Formats a number with a fixed number of decimal places |
| `DOLLAR` | `DOLLAR(number, [decimals])` | Formats a number as currency with a dollar sign |
| `SPLIT` | `SPLIT(text, delimiter, [split_by_each], [remove_empty])` | Splits text around a delimiter |
| `JOIN` | `JOIN(delimiter, value1, [value2, ...])` | Joins values with a delimiter |
| `REGEXMATCH` | `REGEXMATCH(text, regular_expression)` | Returns whether text matches a regular expression |
| `REGEXEXTRACT` | `REGEXEXTRACT(text, regular_expression)` | Extracts matching substrings using a regular expression |
| `REGEXREPLACE` | `REGEXREPLACE(text, regular_expression, replacement)` | Replaces text matching a regular expression |
| `UNICODE` | `UNICODE(text)` | Returns the Unicode code point of the first character |
| `UNICHAR` | `UNICHAR(number)` | Returns the Unicode character for a code point |
| `ENCODEURL` | `ENCODEURL(text)` | Encodes a string for use in a URL |
| `TEXTBEFORE` | `TEXTBEFORE(text, delimiter, [instance_num])` | Returns text before a specified delimiter |
| `TEXTAFTER` | `TEXTAFTER(text, delimiter, [instance_num])` | Returns text after a specified delimiter |
| `VALUETOTEXT` | `VALUETOTEXT(value, [format])` | Converts a value to text |
| `TEXTSPLIT` | `TEXTSPLIT(text, col_delimiter, [row_delimiter], [ignore_empty])` | Splits text by delimiter into parts |
| `LENB` | `LENB(text)` | Returns the number of bytes (UTF-8) in a text string |
| `LEFTB` | `LEFTB(text, [num_bytes])` | Returns the leftmost characters from a text string by byte count |
| `RIGHTB` | `RIGHTB(text, [num_bytes])` | Returns the rightmost characters from a text string by byte count |
| `MIDB` | `MIDB(text, start_num, num_bytes)` | Returns characters from the middle of a text string by byte position |
| `FINDB` | `FINDB(search_for, text_to_search, [starting_at])` | Finds one text value inside another by byte position (case-sensitive) |
| `SEARCHB` | `SEARCHB(search_for, text_to_search, [starting_at])` | Finds one text value inside another by byte position (case-insensitive) |
| `REPLACEB` | `REPLACEB(old_text, start_num, num_bytes, new_text)` | Replaces part of a text string by byte position |
| `ASC` | `ASC(text)` | Converts full-width (double-byte) characters to half-width |

## Database

| Function | Syntax | Description |
|---|---|---|
| `DSUM` | `DSUM(database, field, criteria)` | Sums values in a database field matching criteria |
| `DCOUNT` | `DCOUNT(database, field, criteria)` | Counts numeric values in a database field matching criteria |
| `DCOUNTA` | `DCOUNTA(database, field, criteria)` | Counts non-empty values in a database field matching criteria |
| `DAVERAGE` | `DAVERAGE(database, field, criteria)` | Averages values in a database field matching criteria |
| `DMAX` | `DMAX(database, field, criteria)` | Returns the maximum value in a database field matching criteria |
| `DMIN` | `DMIN(database, field, criteria)` | Returns the minimum value in a database field matching criteria |
| `DPRODUCT` | `DPRODUCT(database, field, criteria)` | Returns the product of values in a database field matching criteria |
| `DGET` | `DGET(database, field, criteria)` | Returns a single value from a database field matching criteria |
| `DSTDEV` | `DSTDEV(database, field, criteria)` | Returns the sample standard deviation of a database field matching criteria |
| `DSTDEVP` | `DSTDEVP(database, field, criteria)` | Returns the population standard deviation of a database field matching criteria |
| `DVAR` | `DVAR(database, field, criteria)` | Returns the sample variance of a database field matching criteria |
| `DVARP` | `DVARP(database, field, criteria)` | Returns the population variance of a database field matching criteria |

## Related

- [Formulas](/sheets/formulas) to enter a formula, reference other tabs, and fix error values.
- [Build a budget](/sheets/build-a-budget) for a worked example with `SUM` and `IF`.
