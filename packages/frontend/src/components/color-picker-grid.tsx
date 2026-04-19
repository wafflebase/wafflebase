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
        className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
        onClick={onReset}
      >
        <IconDropletOff size={14} />
        Reset
      </button>
      <div className="grid grid-cols-5 gap-1">
        {colors.map((color) => (
          <button
            key={color}
            className="h-5 w-5 cursor-pointer rounded border border-border hover:scale-125 transition-transform"
            style={{ backgroundColor: color }}
            onClick={() => onSelect(color)}
          />
        ))}
      </div>
    </>
  );
}
