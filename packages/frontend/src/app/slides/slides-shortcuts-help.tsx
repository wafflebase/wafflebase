import { useMemo } from "react";
import {
  SHORTCUTS,
  formatCombo,
  type ShortcutCategory,
  type ShortcutEntry,
} from "@wafflebase/slides";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SlidesShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_ORDER: ReadonlyArray<ShortcutCategory> = [
  "Selection",
  "Slide",
  "Nudge",
  "Drag",
  "Clipboard",
  "Z-order",
  "Format",
  "Present",
  "Help",
];

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function SlidesShortcutsHelp({
  open,
  onOpenChange,
}: SlidesShortcutsHelpProps) {
  const isMac = useMemo(() => isMacPlatform(), []);
  const grouped = useMemo(() => groupByCategory(SHORTCUTS), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 mt-2">
          {CATEGORY_ORDER.map((category) => {
            const entries = grouped.get(category);
            if (!entries || entries.length === 0) return null;
            return (
              <section key={category}>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  {category}
                </h3>
                <ul className="space-y-1">
                  {entries.map((entry, idx) => (
                    <li
                      key={`${category}-${idx}`}
                      className="flex items-start justify-between gap-3 text-sm"
                    >
                      <span className="flex-1 leading-snug">
                        {entry.description}
                      </span>
                      <span className="flex flex-wrap gap-1 shrink-0">
                        {entry.keys.map((combo, k) => (
                          <kbd
                            key={k}
                            className="px-1.5 py-0.5 rounded border bg-muted text-xs font-mono whitespace-nowrap"
                          >
                            {formatCombo(combo, isMac)}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function groupByCategory(
  entries: ReadonlyArray<ShortcutEntry>,
): Map<ShortcutCategory, ShortcutEntry[]> {
  const map = new Map<ShortcutCategory, ShortcutEntry[]>();
  for (const entry of entries) {
    const list = map.get(entry.category);
    if (list) {
      list.push(entry);
    } else {
      map.set(entry.category, [entry]);
    }
  }
  return map;
}
