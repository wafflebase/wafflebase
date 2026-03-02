import { useEffect, useRef } from "react";
import {
  IconCopy,
  IconCut,
  IconClipboard,
  IconTrash,
} from "@tabler/icons-react";

interface MobileContextMenuProps {
  x: number;
  y: number;
  readOnly?: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function MobileContextMenu({
  x,
  y,
  readOnly = false,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onClose,
}: MobileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose]);

  // Position menu above touch point; flip below if too close to top
  const menuHeight = 192; // approximate 4 items × 48px
  const menuWidth = 160;
  const showAbove = y > menuHeight + 16;
  const top = showAbove ? y - menuHeight - 8 : y + 8;
  const left = Math.min(
    Math.max(8, x - menuWidth / 2),
    window.innerWidth - menuWidth - 8,
  );

  const items = [
    { icon: IconCut, label: "Cut", action: onCut, disabled: readOnly },
    { icon: IconCopy, label: "Copy", action: onCopy, disabled: false },
    {
      icon: IconClipboard,
      label: "Paste",
      action: onPaste,
      disabled: readOnly,
    },
    { icon: IconTrash, label: "Delete", action: onDelete, disabled: readOnly },
  ];

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Cell actions"
      className="fixed z-50 min-w-[160px] rounded-lg border bg-background shadow-lg"
      style={{ top, left }}
    >
      {items.map(({ icon: Icon, label, action, disabled }) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-3 px-3 py-3 text-sm hover:bg-accent disabled:opacity-40 first:rounded-t-lg last:rounded-b-lg"
          disabled={disabled}
          onClick={() => {
            action();
            onClose();
          }}
        >
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
