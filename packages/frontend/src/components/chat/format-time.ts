/** A message's clock time in the reader's locale, e.g. "10:02 AM". */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
