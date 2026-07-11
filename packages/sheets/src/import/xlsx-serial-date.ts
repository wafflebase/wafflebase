// Excel stores dates as serial numbers: whole part = days since the epoch of
// the workbook's date system, fractional part = time of day. In the default
// 1900 system serial 25569 is the Unix epoch 1970-01-01, so `(serial - 25569)`
// days converts to Unix time. The legacy 1904 system (`workbookPr date1904="1"`,
// historically the Mac default) sits 1,462 days earlier.
const EXCEL_UNIX_EPOCH_DAYS = 25569;
const DATE_1904_OFFSET_DAYS = 1462;
const MS_PER_DAY = 86_400_000;

/**
 * Converts an Excel date serial to the model's date value format:
 * - `HH:MM:SS` for a pure time-of-day (serial in `[0, 1)`, no calendar date);
 * - `YYYY-MM-DD` for a whole-day date;
 * - `YYYY-MM-DD HH:MM:SS` for a date carrying a time fraction.
 *
 * `date1904` selects the workbook's date system (1904 epoch when true). Returns
 * undefined for values that are not finite serials. UTC components are used so
 * the calendar date does not shift by timezone.
 */
export function excelSerialToDateString(
  serial: number,
  date1904 = false,
): string | undefined {
  if (!Number.isFinite(serial)) {
    return undefined;
  }
  const epochDays = date1904
    ? EXCEL_UNIX_EPOCH_DAYS - DATE_1904_OFFSET_DAYS
    : EXCEL_UNIX_EPOCH_DAYS;
  const ms = Math.round((serial - epochDays) * MS_PER_DAY);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  const hms = `${hour}:${minute}:${second}`;

  // A serial in [0, 1) is a time of day with no meaningful calendar date;
  // render just the time rather than a spurious 1899-12-30 prefix.
  if (serial >= 0 && serial < 1) {
    return hms;
  }

  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const ymd = `${year}-${month}-${day}`;
  return serial % 1 !== 0 ? `${ymd} ${hms}` : ymd;
}
