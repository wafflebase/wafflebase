/** Shared stat card for the analytics dashboards. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-2xl font-semibold">
        {value}
        {hint && (
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
