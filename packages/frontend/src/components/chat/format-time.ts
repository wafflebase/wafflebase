/** A message's clock time in the reader's locale, e.g. "10:02 AM". */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The clock time without its AM/PM marker, e.g. "10:02", for the narrow
 * gutter beside a continuation message. The marker is what pushed "10:02 PM"
 * onto two lines there; the header above the group already carries it.
 */
export function formatShortTime(iso: string): string {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" })
    .formatToParts(new Date(iso))
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
}
