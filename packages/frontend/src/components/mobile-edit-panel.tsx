import { useCallback, useEffect, useRef, useState } from "react";
import { IconCheck, IconX } from "@tabler/icons-react";
import { useKeyboardOffset } from "../hooks/use-keyboard-offset";

interface MobileEditPanelProps {
  cellRef: string;
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  onValueChange?: (value: string) => void;
}

export function MobileEditPanel({
  cellRef,
  initialValue,
  onCommit,
  onCancel,
  onValueChange,
}: MobileEditPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const keyboardOffset = useKeyboardOffset();

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(0, el.value.length);
    }
  }, []);

  const handleCommit = useCallback(() => {
    onCommit(value);
  }, [onCommit, value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCommit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [handleCommit, onCancel],
  );

  return (
    <div
      className="fixed inset-x-0 z-50 border-t bg-background px-2 py-1.5 shadow-lg"
      style={{
        bottom: keyboardOffset,
        paddingBottom: `max(env(safe-area-inset-bottom, 0px), 6px)`,
      }}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {cellRef}
        </span>
        <input
          ref={inputRef}
          type="text"
          className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onValueChange?.(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          enterKeyHint="done"
        />
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted cursor-pointer"
          onClick={onCancel}
          aria-label="Cancel editing"
        >
          <IconX size={18} />
        </button>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-primary hover:bg-primary/10 cursor-pointer"
          onClick={handleCommit}
          aria-label="Confirm editing"
        >
          <IconCheck size={18} />
        </button>
      </div>
    </div>
  );
}
