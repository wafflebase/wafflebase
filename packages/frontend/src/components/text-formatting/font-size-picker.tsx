/**
 * Shared font-size picker. Stateless — the caller owns the current size
 * and reacts to `onChange`. The component combines:
 *   - a `−` button that decrements by 1pt,
 *   - a numeric input that commits on Enter / blur,
 *   - a `+` button that increments by 1pt,
 *   - a chevron-trigger preset dropdown.
 *
 * Commit policy: `onChange` fires only on Enter, blur, ± click, or preset
 * pick — never on every keystroke. Typed values that clamp to the current
 * value are skipped to avoid spurious updates. An undefined `value`
 * renders an empty input so mixed selections don't pin a misleading size.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconPlus, IconMinus } from "@tabler/icons-react";
import {
  FONT_SIZE_PRESETS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
} from "./font-catalog";

interface FontSizePickerProps {
  /** Current size, or undefined for mixed/unset. */
  value: number | undefined;
  /** Fired only on commit (Enter, blur, ±, preset pick). */
  onChange: (size: number) => void;
  disabled?: boolean;
}

const clamp = (n: number) =>
  Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(n)));

export function FontSizePicker({
  value,
  onChange,
  disabled,
}: FontSizePickerProps) {
  const [draft, setDraft] = useState<string>(
    value !== undefined ? String(value) : "",
  );
  const lastValue = useRef(value);

  useEffect(() => {
    if (value !== lastValue.current) {
      setDraft(value !== undefined ? String(value) : "");
      lastValue.current = value;
    }
  }, [value]);

  const commit = (n: number) => {
    const clamped = clamp(n);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  const tryCommitText = (text: string) => {
    const n = Number(text);
    if (!Number.isFinite(n) || text.trim() === "") {
      setDraft(value !== undefined ? String(value) : "");
      return;
    }
    commit(n);
  };

  const tryCommitDraft = () => {
    tryCommitText(draft);
  };

  const step = (delta: number) => {
    const base = value ?? Number(draft);
    if (!Number.isFinite(base)) return;
    const next = clamp(base + delta);
    if (next === base) return;
    commit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Read the latest text directly from the input element. React's
      // pending state from the synthetic `input` event may not have
      // flushed into `draft` yet when Enter fires in the same tick
      // (e.g. inside a single `act()` block in tests), so going through
      // the DOM avoids reading a stale closure.
      tryCommitText(e.currentTarget.value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(-1);
    }
  };

  return (
    <DropdownMenu>
      <div className="inline-flex h-7 items-center rounded-md border border-transparent hover:border-border">
        <button
          type="button"
          aria-label="Decrease font size"
          disabled={disabled}
          onClick={() => step(-1)}
          className="inline-flex h-7 w-5 cursor-pointer items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <IconMinus size={12} />
        </button>
        <DropdownMenuTrigger asChild>
          <input
            aria-label="Font size"
            type="number"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={tryCommitDraft}
            onKeyDown={onKeyDown}
            className="h-7 w-8 bg-transparent text-center text-xs outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
        </DropdownMenuTrigger>
        <button
          type="button"
          aria-label="Increase font size"
          disabled={disabled}
          onClick={() => step(1)}
          className="inline-flex h-7 w-5 cursor-pointer items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <IconPlus size={12} />
        </button>
      </div>
      <DropdownMenuContent
        align="center"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {FONT_SIZE_PRESETS.map((s) => (
          <DropdownMenuItem key={s} onClick={() => commit(s)}>
            {s}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
