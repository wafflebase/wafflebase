import { SHORTCUTS, formatCombo, type ShortcutCategory } from "@wafflebase/sheets";
import { ShortcutsHelpDialog } from "@/components/shortcuts-help-dialog";

interface SheetsShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_ORDER: ReadonlyArray<ShortcutCategory> = [
  "Navigation",
  "Selection",
  "Editing",
  "Clipboard",
  "Format",
  "Find",
  "Comments",
  "History",
  "Help",
];

export function SheetsShortcutsHelp({
  open,
  onOpenChange,
}: SheetsShortcutsHelpProps) {
  return (
    <ShortcutsHelpDialog
      open={open}
      onOpenChange={onOpenChange}
      shortcuts={SHORTCUTS}
      categoryOrder={CATEGORY_ORDER}
      formatCombo={formatCombo}
    />
  );
}
