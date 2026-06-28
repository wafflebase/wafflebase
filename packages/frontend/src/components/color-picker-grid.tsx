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
}

export function ColorPickerGrid({
  colors,
  onSelect,
  onReset,
  noneLabel = "Reset",
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
            aria-label={`Select color ${color}`}
            title={color}
            onClick={() => onSelect(color)}
          />
        ))}
      </div>
    </>
  );
}
