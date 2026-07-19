import { NoneSwatch } from "./none-swatch";

interface ColorPickerGridProps {
  colors: string[];
  onSelect: (color: string) => void;
  onReset: () => void;
  /**
   * Label for the clear/none control. Defaults to "Reset" (restore the
   * default color — used by text-color pickers). Fill / highlight pickers
   * pass "None" since clearing there means transparent.
   */
  noneLabel?: string;
  /**
   * What kind of color this grid sets, woven into each swatch's
   * `aria-label` (e.g. "text color" → "Select text color #ff0000") so a
   * screen reader can tell a text-color grid apart from a background /
   * highlight grid. Defaults to the generic "color".
   */
  colorKind?: string;
}

export function ColorPickerGrid({
  colors,
  onSelect,
  onReset,
  noneLabel = "Reset",
  colorKind = "color",
}: ColorPickerGridProps) {
  return (
    <>
      <button
        type="button"
        data-none-control
        aria-label={noneLabel}
        className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
        onClick={onReset}
      >
        <NoneSwatch />
        {noneLabel}
      </button>
      <div className="grid grid-cols-8 gap-1">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            className="h-5 w-5 cursor-pointer rounded-sm border border-border hover:scale-125 transition-transform"
            style={{ backgroundColor: color }}
            aria-label={`Select ${colorKind} ${color}`}
            title={color}
            onClick={() => onSelect(color)}
          />
        ))}
      </div>
    </>
  );
}
