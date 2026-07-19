import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRESET_LABELS, PRESET_ORDER, type RangePreset } from "./presets";

export function DateRangePicker({
  value,
  onChange,
}: {
  value: RangePreset;
  onChange: (preset: RangePreset) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as RangePreset)}>
      <SelectTrigger className="w-40" aria-label="Date range">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRESET_ORDER.map((p) => (
          <SelectItem key={p} value={p}>
            {PRESET_LABELS[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
