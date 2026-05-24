import { IconDropletOff } from "@tabler/icons-react";

interface ColorPickerGridProps {
  colors: string[];
  onSelect: (color: string) => void;
  onReset: () => void;
}

export function ColorPickerGrid({ colors, onSelect, onReset }: ColorPickerGridProps) {
  return (
    <>
      <button
        type="button"
        className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
        aria-label="Reset color"
        onClick={onReset}
      >
        <IconDropletOff size={14} />
        Reset
      </button>
      <div className="grid grid-cols-8 gap-1">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            className="h-4 w-4 cursor-pointer rounded-sm border border-border hover:scale-125 transition-transform"
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
