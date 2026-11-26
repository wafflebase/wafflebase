/** A message's clock time in the reader's locale, e.g. "10:02 AM". */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One formatter for every gutter line; building one per call is costly. */
const CLOCK = new Intl.DateTimeFormat([], {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * The clock time without its AM/PM marker, e.g. "10:02", for the narrow
 * gutter beside a continuation message. The marker is what pushed "10:02 PM"
 * onto two lines there; the header above the group already carries it.
 */
export function formatShortTime(iso: string): string {
  return CLOCK.formatToParts(new Date(iso))
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
}

/**
 * A day divider's label: "Today", "Yesterday", "Wed, Nov 25" within this
 * year, and "November 25, 2025" before it, where the weekday no longer helps
 * and the year has to be there.
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.getFullYear() === now.getFullYear()
    ? d.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : d.toLocaleDateString([], {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
}
