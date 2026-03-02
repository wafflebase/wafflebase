import { useCallback, useEffect, useRef, useState } from "react";
import { IconCheck, IconX } from "@tabler/icons-react";
import { useKeyboardOffset } from "../hooks/use-keyboard-offset";

const MaxLines = 4;
const LineHeight = 20;

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initialValue);
  const keyboardOffset = useKeyboardOffset();

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, LineHeight * MaxLines)}px`;
  }, []);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(0, el.value.length);
      autoGrow();
    }
  }, [autoGrow]);

  const handleCommit = useCallback(() => {
    onCommit(value);
  }, [onCommit, value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [onCancel],
  );

  return (
    <div
      className="fixed inset-x-0 z-50 border-t bg-background px-2 py-1.5 shadow-lg"
      style={{
        bottom: keyboardOffset,
        paddingBottom: `max(env(safe-area-inset-bottom, 0px), 6px)`,
      }}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {cellRef}
        </span>
        <textarea
          ref={textareaRef}
          className="min-w-0 flex-1 resize-none rounded border bg-background px-2 py-1 text-sm leading-5 outline-none focus:ring-1 focus:ring-ring"
          rows={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onValueChange?.(e.target.value);
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted cursor-pointer"
          onClick={onCancel}
          aria-label="Cancel editing"
        >
          <IconX size={18} />
        </button>
        <button
          type="button"
          className="mt-0.5 shrink-0 rounded p-1 text-primary hover:bg-primary/10 cursor-pointer"
          onClick={handleCommit}
          aria-label="Confirm editing"
        >
          <IconCheck size={18} />
        </button>
      </div>
    </div>
  );
}
