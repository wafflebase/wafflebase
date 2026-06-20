import { IconMessage2Plus } from "@tabler/icons-react";

interface Props {
  /** Runs `beginCompose` and closes the host menu. */
  onSelect: () => void;
  /** Host menu's button class — the two menus share identical styling. */
  className: string;
}

/**
 * Shared "Insert comment" row. Both the text context menu
 * (`DocsCommentContextMenu`) and the table context menu
 * (`DocsTableContextMenu`) render it, so the label, icon, and ⌘⌥M
 * shortcut hint live in one place and can't drift apart.
 */
export function InsertCommentMenuItem({ onSelect, className }: Props) {
  return (
    <button className={className} onClick={onSelect}>
      <IconMessage2Plus size={16} className="text-muted-foreground" />
      Insert comment
      <span className="ml-auto text-xs text-muted-foreground">⌘⌥M</span>
    </button>
  );
}
