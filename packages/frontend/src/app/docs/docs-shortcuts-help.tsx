import { SHORTCUTS, formatCombo, type ShortcutCategory } from "@wafflebase/docs";
import { ShortcutsHelpDialog } from "@/components/shortcuts-help-dialog";

interface DocsShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_ORDER: ReadonlyArray<ShortcutCategory> = [
  "Editing",
  "Navigation",
  "Format",
  "Paragraph",
  "Find",
  "Comments",
  "History",
  "Help",
];

export function DocsShortcutsHelp({
  open,
  onOpenChange,
}: DocsShortcutsHelpProps) {
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
