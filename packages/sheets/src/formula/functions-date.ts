import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode, ErrNode } from './formula';
import { NumberArgs } from './arguments';
import { Grid } from '../model/core/types';
import {
  toSrefs,
} from '../model/core/coordinates';
import {
  toStr,
} from './functions-helpers';

/**
 * `todayFunc` is the implementation of the TODAY function.
 * TODAY() — returns the current date as YYYY-MM-DD.
 */
export function todayFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return ErrNode.NA;
  }

  return { t: 'str', v: formatDate(new Date()) };
}

/**
 * `nowFunc` is the implementation of the NOW function.
 * NOW() — returns the current date and time as YYYY-MM-DD HH:MM:SS.
 */
export function nowFunc(
  ctx: FunctionContext,
  _visit: (tree: ParseTree) => EvalNode,
  _grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (args && args.expr().length > 0) {
    return ErrNode.NA;
  }

  const now = new Date();
  return { t: 'str', v: `${formatDate(now)} ${formatTime(now)}` };
}

/**
 * `dateFunc` is the implementation of the DATE function.
 * DATE(year, month, day) — returns a normalized date as YYYY-MM-DD.
 */
export function dateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 3) {
    return ErrNode.NA;
  }

  const yearNode = NumberArgs.map(visit(exprs[0]), grid);
  if (yearNode.t === 'err') {
    return yearNode;
  }
  const monthNode = NumberArgs.map(visit(exprs[1]), grid);
  if (monthNode.t === 'err') {
    return monthNode;
  }
  const dayNode = NumberArgs.map(visit(exprs[2]), grid);
  if (dayNode.t === 'err') {
    return dayNode;
  }

  const year = Math.trunc(yearNode.v);
  const month = Math.trunc(monthNode.v);
  const day = Math.trunc(dayNode.v);
  if (!isFinite(year) || !isFinite(month) || !isFinite(day)) {
    return ErrNode.VALUE;
  }

  return { t: 'str', v: formatDate(new Date(year, month - 1, day)) };
}

/**
 * `timeFunc` is the implementation of the TIME function.
 * TIME(hour, minute, second) — returns a normalized time as HH:MM:SS.
 */
export function timeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 3) {
    return ErrNode.NA;
  }

  const hourNode = NumberArgs.map(visit(exprs[0]), grid);
  if (hourNode.t === 'err') {
    return hourNode;
  }
  const minuteNode = NumberArgs.map(visit(exprs[1]), grid);
  if (minuteNode.t === 'err') {
    return minuteNode;
  }
  const secondNode = NumberArgs.map(visit(exprs[2]), grid);
  if (secondNode.t === 'err') {
    return secondNode;
  }

  const hour = Math.trunc(hourNode.v);
  const minute = Math.trunc(minuteNode.v);
  const second = Math.trunc(secondNode.v);
  if (!isFinite(hour) || !isFinite(minute) || !isFinite(second)) {
    return ErrNode.VALUE;
  }

  return { t: 'str', v: formatTime(new Date(1970, 0, 1, hour, minute, second)) };
}

/**
 * `daysFunc` is the implementation of the DAYS function.
 * DAYS(end_date, start_date) — returns the number of days between two dates.
 */
export function daysFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return ErrNode.NA;
  }

  const endDate = parseDate(visit(exprs[0]), grid);
  if (!(endDate instanceof Date)) {
    return endDate;
  }

  const startDate = parseDate(visit(exprs[1]), grid);
  if (!(startDate instanceof Date)) {
    return startDate;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const endUtc = Date.UTC(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
  );
  const startUtc = Date.UTC(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );

  return { t: 'num', v: (endUtc - startUtc) / dayMs };
}

/**
 * `yearFunc` is the implementation of the YEAR function.
 * YEAR(date) — returns the year from a date.
 */
export function yearFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) return date;

  return { t: 'num', v: date.getFullYear() };
}

/**
 * `monthFunc` is the implementation of the MONTH function.
 * MONTH(date) — returns the month (1-12) from a date.
 */
export function monthFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) return date;

  return { t: 'num', v: date.getMonth() + 1 };
}

/**
 * `dayFunc` is the implementation of the DAY function.
 * DAY(date) — returns the day of the month from a date.
 */
export function dayFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) return date;

  return { t: 'num', v: date.getDate() };
}

/**
 * `hourFunc` is the implementation of the HOUR function.
 * HOUR(time) — returns hour (0-23) from a time/datetime value.
 */
export function hourFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const date = parseDateTime(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  return { t: 'num', v: date.getHours() };
}

/**
 * `minuteFunc` is the implementation of the MINUTE function.
 * MINUTE(time) — returns minute (0-59) from a time/datetime value.
 */
export function minuteFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const date = parseDateTime(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  return { t: 'num', v: date.getMinutes() };
}

/**
 * `secondFunc` is the implementation of the SECOND function.
 * SECOND(time) — returns second (0-59) from a time/datetime value.
 */
export function secondFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const date = parseDateTime(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  return { t: 'num', v: date.getSeconds() };
}

/**
 * `weekdayFunc` is the implementation of the WEEKDAY function.
 * WEEKDAY(date, [type]) — returns day-of-week index based on numbering type.
 */
export function weekdayFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return ErrNode.NA;
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  let type = 1;
  if (exprs.length === 2) {
    const typeNode = NumberArgs.map(visit(exprs[1]), grid);
    if (typeNode.t === 'err') {
      return typeNode;
    }
    type = Math.trunc(typeNode.v);
  }

  const day = date.getDay(); // Sunday = 0
  if (type === 1) {
    return { t: 'num', v: day + 1 };
  }
  if (type === 2) {
    return { t: 'num', v: day === 0 ? 7 : day };
  }
  if (type === 3) {
    return { t: 'num', v: day === 0 ? 6 : day - 1 };
  }

  return ErrNode.VALUE;
}

/**
 * EDATE(start_date, months) — returns a date that is a given number of months before/after.
 */
export function edateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return ErrNode.NA;
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  const monthsNode = NumberArgs.map(visit(exprs[1]), grid);
  if (monthsNode.t === 'err') {
    return monthsNode;
  }

  const months = Math.trunc(monthsNode.v);
  const result = new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
  return { t: 'str', v: formatDate(result) };
}

/**
 * EOMONTH(start_date, months) — returns the last day of a month a given number of months away.
 */
export function eomonthFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 2) {
    return ErrNode.NA;
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  const monthsNode = NumberArgs.map(visit(exprs[1]), grid);
  if (monthsNode.t === 'err') {
    return monthsNode;
  }

  const months = Math.trunc(monthsNode.v);
  // Day 0 of the next month = last day of the target month
  const result = new Date(date.getFullYear(), date.getMonth() + months + 1, 0);
  return { t: 'str', v: formatDate(result) };
}

/**
 * NETWORKDAYS(start_date, end_date) — returns the number of working days between two dates.
 * Excludes weekends (Saturday and Sunday). Holidays parameter not supported.
 */
export function networkdaysFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return ErrNode.NA;
  }

  const startDate = parseDate(visit(exprs[0]), grid);
  if (!(startDate instanceof Date)) {
    return startDate;
  }

  const endDate = parseDate(visit(exprs[1]), grid);
  if (!(endDate instanceof Date)) {
    return endDate;
  }

  const direction = startDate <= endDate ? 1 : -1;
  const start = direction === 1 ? startDate : endDate;
  const end = direction === 1 ? endDate : startDate;

  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return { t: 'num', v: count * direction };
}

/**
 * NETWORKDAYS.INTL(start_date, end_date, [weekend], [holidays])
 * Returns the number of working days between two dates with custom weekends.
 */
export function networkdaysintlFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 4) return ErrNode.NA;

  const startDate = parseDate(visit(exprs[0]), grid);
  if ('t' in startDate) return startDate;
  const endDate = parseDate(visit(exprs[1]), grid);
  if ('t' in endDate) return endDate;

  let weekendDays = new Set([0, 6]);
  if (exprs.length >= 3) {
    const wNode = NumberArgs.map(visit(exprs[2]), grid);
    if (wNode.t !== 'err') {
      weekendDays = getWeekendDays(Math.trunc(wNode.v));
    }
  }

  const holidays = new Set<string>();
  if (exprs.length >= 4) {
    const hNode = visit(exprs[3]);
    if (hNode.t === 'ref' && grid) {
      for (const sref of toSrefs([hNode.v])) {
        const cell = grid.get(sref);
        if (cell?.v) {
          const hd = new Date(cell.v);
          if (!isNaN(hd.getTime())) {
            holidays.add(hd.toISOString().slice(0, 10));
          }
        }
      }
    }
  }

  const direction = endDate >= startDate ? 1 : -1;
  const current = new Date(startDate);
  let count = 0;
  while ((direction > 0 && current <= endDate) || (direction < 0 && current >= endDate)) {
    if (!weekendDays.has(current.getDay()) && !holidays.has(current.toISOString().slice(0, 10))) {
      count++;
    }
    current.setDate(current.getDate() + direction);
  }

  return { t: 'num', v: count * direction };
}

/**
 * DATEVALUE(date_string) — converts a date string to a date value.
 */
export function datevalueFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  return { t: 'str', v: formatDate(date) };
}

/**
 * TIMEVALUE(time_string) — converts a time string to a time value (fraction of a day).
 */
export function timevalueFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const date = parseDateTime(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const fraction = (hours * 3600 + minutes * 60 + seconds) / 86400;

  return { t: 'num', v: fraction };
}

/**
 * DATEDIF(start_date, end_date, unit) — calculates the difference between two dates.
 * Units: "Y" (years), "M" (months), "D" (days).
 */
export function datedifFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 3) {
    return ErrNode.NA;
  }

  const startDate = parseDate(visit(exprs[0]), grid);
  if (!(startDate instanceof Date)) {
    return startDate;
  }

  const endDate = parseDate(visit(exprs[1]), grid);
  if (!(endDate instanceof Date)) {
    return endDate;
  }

  if (startDate > endDate) {
    return ErrNode.VALUE;
  }

  const unitStr = toStr(visit(exprs[2]), grid);
  if (unitStr.t === 'err') {
    return unitStr;
  }

  const unit = unitStr.v.toUpperCase();

  if (unit === 'D') {
    const dayMs = 24 * 60 * 60 * 1000;
    const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    return { t: 'num', v: (endUtc - startUtc) / dayMs };
  }

  if (unit === 'M') {
    let months =
      (endDate.getFullYear() - startDate.getFullYear()) * 12 +
      (endDate.getMonth() - startDate.getMonth());
    if (endDate.getDate() < startDate.getDate()) {
      months--;
    }
    return { t: 'num', v: months };
  }

  if (unit === 'Y') {
    let years = endDate.getFullYear() - startDate.getFullYear();
    if (
      endDate.getMonth() < startDate.getMonth() ||
      (endDate.getMonth() === startDate.getMonth() && endDate.getDate() < startDate.getDate())
    ) {
      years--;
    }
    return { t: 'num', v: years };
  }

  if (unit === 'MD') {
    let days = endDate.getDate() - startDate.getDate();
    if (days < 0) {
      const prevMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 0);
      days += prevMonth.getDate();
    }
    return { t: 'num', v: days };
  }

  if (unit === 'YM') {
    let months = endDate.getMonth() - startDate.getMonth();
    if (months < 0) {
      months += 12;
    }
    if (endDate.getDate() < startDate.getDate()) {
      months--;
      if (months < 0) months += 12;
    }
    return { t: 'num', v: months };
  }

  if (unit === 'YD') {
    const startAdjusted = new Date(endDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    if (startAdjusted > endDate) {
      startAdjusted.setFullYear(startAdjusted.getFullYear() - 1);
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const startUtc = Date.UTC(startAdjusted.getFullYear(), startAdjusted.getMonth(), startAdjusted.getDate());
    const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    return { t: 'num', v: (endUtc - startUtc) / dayMs };
  }

  return ErrNode.VALUE;
}

/**
 * WEEKNUM(date, [type]) — returns the week number of the year.
 * type=1 (default): week starts Sunday. type=2: week starts Monday.
 */
export function weeknumFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) {
    return ErrNode.NA;
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  let type = 1;
  if (exprs.length === 2) {
    const typeNode = NumberArgs.map(visit(exprs[1]), grid);
    if (typeNode.t === 'err') {
      return typeNode;
    }
    type = Math.trunc(typeNode.v);
  }

  const jan1 = new Date(date.getFullYear(), 0, 1);
  const startDay = type === 2 ? 1 : 0;
  const jan1Day = jan1.getDay();
  const dayOffset = (jan1Day - startDay + 7) % 7;
  const weekStart = new Date(jan1.getTime() - dayOffset * 86400000);
  const diff = date.getTime() - weekStart.getTime();
  const weekNum = Math.floor(diff / (7 * 86400000)) + 1;

  return { t: 'num', v: weekNum };
}

/**
 * ISOWEEKNUM(date) — returns the ISO week number of the year.
 */
export function isoweeknumFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length !== 1) {
    return ErrNode.NA;
  }

  const date = parseDate(visit(exprs[0]), grid);
  if (!(date instanceof Date)) {
    return date;
  }

  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  return { t: 'num', v: weekNo };
}

/**
 * WORKDAY(start_date, days, [holidays]) — returns a date that is a specified number of working days away.
 */
export function workdayFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return ErrNode.NA;
  }

  const startDate = parseDate(visit(exprs[0]), grid);
  if (!(startDate instanceof Date)) {
    return startDate;
  }

  const daysNode = NumberArgs.map(visit(exprs[1]), grid);
  if (daysNode.t === 'err') {
    return daysNode;
  }

  const holidayDates = new Set<string>();
  if (exprs.length === 3) {
    const holNode = visit(exprs[2]);
    if (holNode.t === 'err') {
      return holNode;
    }
    if (holNode.t === 'ref' && grid) {
      for (const ref of toSrefs([holNode.v])) {
        const cellVal = grid.get(ref)?.v || '';
        if (cellVal) {
          holidayDates.add(cellVal);
        }
      }
    } else if (holNode.t === 'str') {
      holidayDates.add(holNode.v);
    }
  }

  let remaining = Math.trunc(daysNode.v);
  const direction = remaining > 0 ? 1 : -1;
  remaining = Math.abs(remaining);
  const current = new Date(startDate);

  while (remaining > 0) {
    current.setDate(current.getDate() + direction);
    const day = current.getDay();
    if (day !== 0 && day !== 6 && !holidayDates.has(formatDate(current))) {
      remaining--;
    }
  }

  return { t: 'str', v: formatDate(current) };
}

/**
 * WORKDAY.INTL(start_date, days, [weekend], [holidays]) — workday with custom weekends.
 * weekend: 1=Sat/Sun (default), 2=Sun/Mon, 7=Fri/Sat, 11-17=single day.
 */
export function workdayintlFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 4) return ErrNode.NA;

  const startDate = parseDate(visit(exprs[0]), grid);
  if ('t' in startDate) return startDate;
  const daysNode = NumberArgs.map(visit(exprs[1]), grid);
  if (daysNode.t === 'err') return daysNode;
  const numDays = Math.trunc(daysNode.v);

  let weekendDays = new Set([0, 6]); // Sunday=0, Saturday=6
  if (exprs.length >= 3) {
    const wNode = NumberArgs.map(visit(exprs[2]), grid);
    if (wNode.t !== 'err') {
      const w = Math.trunc(wNode.v);
      weekendDays = getWeekendDays(w);
    }
  }

  // Collect holidays
  const holidays = new Set<string>();
  if (exprs.length >= 4) {
    const hNode = visit(exprs[3]);
    if (hNode.t === 'ref' && grid) {
      for (const sref of toSrefs([hNode.v])) {
        const cell = grid.get(sref);
        if (cell?.v) {
          const hd = new Date(cell.v);
          if (!isNaN(hd.getTime())) {
            holidays.add(hd.toISOString().slice(0, 10));
          }
        }
      }
    }
  }

  const result = new Date(startDate);
  const direction = numDays >= 0 ? 1 : -1;
  let remaining = Math.abs(numDays);
  while (remaining > 0) {
    result.setDate(result.getDate() + direction);
    if (!weekendDays.has(result.getDay()) && !holidays.has(result.toISOString().slice(0, 10))) {
      remaining--;
    }
  }

  return { t: 'str', v: formatDate(result) };
}

/**
 * YEARFRAC(start_date, end_date, [basis]) — returns the fraction of the year between two dates.
 * basis: 0=US 30/360, 1=actual/actual, 2=actual/360, 3=actual/365, 4=European 30/360.
 */
export function yearfracFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) {
    return ErrNode.NA;
  }

  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) {
    return ErrNode.NA;
  }

  const startDate = parseDate(visit(exprs[0]), grid);
  if (!(startDate instanceof Date)) {
    return startDate;
  }

  const endDate = parseDate(visit(exprs[1]), grid);
  if (!(endDate instanceof Date)) {
    return endDate;
  }

  let basis = 0;
  if (exprs.length === 3) {
    const basisNode = NumberArgs.map(visit(exprs[2]), grid);
    if (basisNode.t === 'err') {
      return basisNode;
    }
    basis = Math.trunc(basisNode.v);
  }

  if (basis < 0 || basis > 4) {
    return ErrNode.VALUE;
  }

  const s = startDate < endDate ? startDate : endDate;
  const e = startDate < endDate ? endDate : startDate;
  const actualDays = Math.round(
    (e.getTime() - s.getTime()) / 86400000,
  );

  switch (basis) {
    case 0: {
      // US (NASD) 30/360
      let d1 = s.getUTCDate();
      let d2 = e.getUTCDate();
      const m1 = s.getUTCMonth() + 1;
      const m2 = e.getUTCMonth() + 1;
      const y1 = s.getUTCFullYear();
      const y2 = e.getUTCFullYear();
      const isLastDayOfFeb = (d: Date): boolean => {
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();
        return m === 1 && d.getUTCDate() === new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      };
      if (isLastDayOfFeb(s)) {
        d1 = 30;
        if (isLastDayOfFeb(e)) d2 = 30;
      }
      if (d1 === 31) d1 = 30;
      if (d2 === 31 && d1 === 30) d2 = 30;
      const days30 = (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
      return { t: 'num', v: days30 / 360 };
    }
    case 4: {
      // European 30/360
      let d1 = Math.min(s.getUTCDate(), 30);
      let d2 = Math.min(e.getUTCDate(), 30);
      const days30 =
        (e.getUTCFullYear() - s.getUTCFullYear()) * 360 +
        (e.getUTCMonth() - s.getUTCMonth()) * 30 +
        (d2 - d1);
      return { t: 'num', v: days30 / 360 };
    }
    case 1: {
      const sy = s.getFullYear();
      const ey = e.getFullYear();
      if (sy === ey) {
        const yearDays = (new Date(sy + 1, 0, 1).getTime() - new Date(sy, 0, 1).getTime()) / 86400000;
        return { t: 'num', v: actualDays / yearDays };
      }
      const years = ey - sy + 1;
      const totalDays = (new Date(ey + 1, 0, 1).getTime() - new Date(sy, 0, 1).getTime()) / 86400000;
      const avgYear = totalDays / years;
      return { t: 'num', v: actualDays / avgYear };
    }
    case 2:
      return { t: 'num', v: actualDays / 360 };
    case 3:
      return { t: 'num', v: actualDays / 365 };
    default:
      return ErrNode.VALUE;
  }
}

/**
 * DAYS360(start_date, end_date, [method]) — days between two dates using 360-day year.
 * method: FALSE (default) = US/NASD, TRUE = European.
 */
export function days360Func(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return ErrNode.NA;
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return ErrNode.NA;

  const startDate = parseDate(visit(exprs[0]), grid);
  if ('t' in startDate) return startDate;
  const endDate = parseDate(visit(exprs[1]), grid);
  if ('t' in endDate) return endDate;

  let european = false;
  if (exprs.length >= 3) {
    const m = visit(exprs[2]);
    european = m.t === 'bool' ? m.v === true : m.t === 'num' ? m.v !== 0 : false;
  }

  let sd = startDate.getDate();
  let sm = startDate.getMonth() + 1;
  let sy = startDate.getFullYear();
  let ed = endDate.getDate();
  let em = endDate.getMonth() + 1;
  let ey = endDate.getFullYear();

  if (european) {
    if (sd > 30) sd = 30;
    if (ed > 30) ed = 30;
  } else {
    // US/NASD method
    if (sd === 31) sd = 30;
    if (ed === 31 && sd >= 30) ed = 30;
  }

  return { t: 'num', v: (ey - sy) * 360 + (em - sm) * 30 + (ed - sd) };
}

/**
 * `todayFunc` is the implementation of the TODAY function.
 * TODAY() — returns the current date as YYYY-MM-DD.
 */
export function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * `parseDate` parses a date from an EvalNode, returning a Date or an error.
 */
export function parseDate(
  node: EvalNode,
  grid?: Grid,
): Date | ErrNode {
  const str = toStr(node, grid);
  if (str.t === 'err') return str;

  const date = new Date(str.v);
  if (isNaN(date.getTime())) {
    return ErrNode.VALUE;
  }
  return date;
}

/**
 * `parseDateTime` parses either a full datetime/date value or a time literal.
 */
function parseDateTime(
  node: EvalNode,
  grid?: Grid,
): Date | ErrNode {
  const str = toStr(node, grid);
  if (str.t === 'err') {
    return str;
  }

  const timeOnly = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(str.v.trim());
  if (timeOnly) {
    const hour = Number(timeOnly[1]);
    const minute = Number(timeOnly[2]);
    const second = Number(timeOnly[3] || '0');
    if (
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      return ErrNode.VALUE;
    }

    return new Date(1970, 0, 1, hour, minute, second);
  }

  const date = new Date(str.v);
  if (isNaN(date.getTime())) {
    return ErrNode.VALUE;
  }

  return date;
}

function getWeekendDays(weekendNum: number): Set<number> {
  switch (weekendNum) {
    case 1: return new Set([0, 6]); // Sat, Sun
    case 2: return new Set([0, 1]); // Sun, Mon
    case 3: return new Set([1, 2]); // Mon, Tue
    case 4: return new Set([2, 3]); // Tue, Wed
    case 5: return new Set([3, 4]); // Wed, Thu
    case 6: return new Set([4, 5]); // Thu, Fri
    case 7: return new Set([5, 6]); // Fri, Sat
    case 11: return new Set([0]);   // Sun only
    case 12: return new Set([1]);   // Mon only
    case 13: return new Set([2]);   // Tue only
    case 14: return new Set([3]);   // Wed only
    case 15: return new Set([4]);   // Thu only
    case 16: return new Set([5]);   // Fri only
    case 17: return new Set([6]);   // Sat only
    default: return new Set([0, 6]);
  }
}

export const dateEntries: [string, (...args: any[]) => EvalNode][] = [
  ['TODAY', todayFunc],
  ['NOW', nowFunc],
  ['DATE', dateFunc],
  ['TIME', timeFunc],
  ['DAYS', daysFunc],
  ['YEAR', yearFunc],
  ['MONTH', monthFunc],
  ['DAY', dayFunc],
  ['HOUR', hourFunc],
  ['MINUTE', minuteFunc],
  ['SECOND', secondFunc],
  ['WEEKDAY', weekdayFunc],
  ['EDATE', edateFunc],
  ['EOMONTH', eomonthFunc],
  ['NETWORKDAYS', networkdaysFunc],
  ['NETWORKDAYS.INTL', networkdaysintlFunc],
  ['DATEVALUE', datevalueFunc],
  ['TIMEVALUE', timevalueFunc],
  ['DATEDIF', datedifFunc],
  ['WEEKNUM', weeknumFunc],
  ['ISOWEEKNUM', isoweeknumFunc],
  ['WORKDAY', workdayFunc],
  ['WORKDAY.INTL', workdayintlFunc],
  ['YEARFRAC', yearfracFunc],
  ['DAYS360', days360Func],
];
