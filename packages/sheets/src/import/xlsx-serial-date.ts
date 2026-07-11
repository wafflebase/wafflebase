// Excel stores dates as serial numbers: whole part = days since the 1900 date
// system epoch (with Excel's 1900-leap-year bug baked in), fractional part =
// time of day. Serial 25569 corresponds to the Unix epoch 1970-01-01, so
// `(serial - 25569)` days converts to Unix time.
const EXCEL_UNIX_EPOCH_DAYS = 25569;
const MS_PER_DAY = 86_400_000;

/**
 * Converts an Excel date serial to the model's date value format:
 * - `HH:MM:SS` for a pure time-of-day (serial in `[0, 1)`, no calendar date);
 * - `YYYY-MM-DD` for a whole-day date;
 * - `YYYY-MM-DD HH:MM:SS` for a date carrying a time fraction.
 *
 * Returns undefined for values that are not finite serials. UTC components are
 * used so the calendar date does not shift by timezone.
 */
export function excelSerialToDateString(serial: number): string | undefined {
  if (!Number.isFinite(serial)) {
    return undefined;
  }
  const ms = Math.round((serial - EXCEL_UNIX_EPOCH_DAYS) * MS_PER_DAY);
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
