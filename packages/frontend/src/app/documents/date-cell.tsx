import { useDateFormat } from "@/lib/date-format-preference";
import { formatFullDateTime, formatListDate } from "./document-list-utils";

/**
 * A date cell's visible text: relative ("3 days ago") or an exact locale date
 * ("Jul 25"), per the user's Settings preference. The full localized date and
 * time is always the tooltip, so the exact timestamp stays reachable in either
 * format — and a missing or unparseable value renders an em dash in both.
 *
 * Its own module so the Trash page can use it without pulling the whole
 * documents list (and its upload queue) into its route chunk.
 */
export function DateCell({ value }: { value: string | undefined }) {
  const format = useDateFormat();
  return (
    <div className="text-right font-medium" title={formatFullDateTime(value)}>
      {formatListDate(value, format)}
    </div>
  );
}
