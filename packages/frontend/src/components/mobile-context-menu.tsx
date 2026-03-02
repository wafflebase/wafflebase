import { useEffect, useRef } from "react";
import {
  IconCopy,
  IconCut,
  IconClipboard,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconTrash,
} from "@tabler/icons-react";

export type MobileContextMenuType = "cell" | "row" | "column";

interface MobileContextMenuProps {
  x: number;
  y: number;
  menuType?: MobileContextMenuType;
  readOnly?: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onInsertBefore?: () => void;
  onInsertAfter?: () => void;
  onClose: () => void;
}

type MenuItem = {
  icon: typeof IconCopy;
  label: string;
  action: () => void;
  disabled: boolean;
};

function buildCellItems(
  props: MobileContextMenuProps,
): MenuItem[] {
  return [
    { icon: IconCut, label: "Cut", action: props.onCut, disabled: !!props.readOnly },
    { icon: IconCopy, label: "Copy", action: props.onCopy, disabled: false },
    { icon: IconClipboard, label: "Paste", action: props.onPaste, disabled: !!props.readOnly },
    { icon: IconTrash, label: "Delete", action: props.onDelete, disabled: !!props.readOnly },
  ];
}

function buildRowItems(
  props: MobileContextMenuProps,
): MenuItem[] {
  return [
    { icon: IconRowInsertTop, label: "Insert row above", action: props.onInsertBefore ?? (() => {}), disabled: !!props.readOnly },
    { icon: IconRowInsertBottom, label: "Insert row below", action: props.onInsertAfter ?? (() => {}), disabled: !!props.readOnly },
    { icon: IconTrash, label: "Delete row", action: props.onDelete, disabled: !!props.readOnly },
  ];
}

function buildColumnItems(
  props: MobileContextMenuProps,
): MenuItem[] {
  return [
    { icon: IconColumnInsertLeft, label: "Insert column left", action: props.onInsertBefore ?? (() => {}), disabled: !!props.readOnly },
    { icon: IconColumnInsertRight, label: "Insert column right", action: props.onInsertAfter ?? (() => {}), disabled: !!props.readOnly },
    { icon: IconTrash, label: "Delete column", action: props.onDelete, disabled: !!props.readOnly },
  ];
}

export function MobileContextMenu(props: MobileContextMenuProps) {
  const { x, y, menuType = "cell", onClose } = props;
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

  const items =
    menuType === "row"
      ? buildRowItems(props)
      : menuType === "column"
        ? buildColumnItems(props)
        : buildCellItems(props);

  // Position menu above touch point; flip below if too close to top
  const itemHeight = 48;
  const menuHeight = items.length * itemHeight;
  const menuWidth = 200;
  const showAbove = y > menuHeight + 16;
  const top = showAbove ? y - menuHeight - 8 : y + 8;
  const left = Math.min(
    Math.max(8, x - menuWidth / 2),
    window.innerWidth - menuWidth - 8,
  );

  const ariaLabel =
    menuType === "row"
      ? "Row actions"
      : menuType === "column"
        ? "Column actions"
        : "Cell actions";

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
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
