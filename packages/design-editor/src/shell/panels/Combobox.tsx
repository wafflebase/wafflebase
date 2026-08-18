import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';
import { cn } from '../lib/cn.ts';

export interface ComboboxOption {
  value: string;
  /** Display label (defaults to `value`). */
  label?: string;
  /** Optional leading adornment, e.g. a token swatch. */
  adornment?: React.ReactNode;
}

interface ComboboxProps {
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible label for the trigger. */
  ariaLabel?: string;
  className?: string;
  /**
   * Extra class on the (portaled) dropdown content. Radix portals `PopoverContent`
   * to `document.body`, escaping the app's `.dark` wrapper — pass `"dark"` here so
   * option swatches reading `var(--role)` resolve the correct theme's colors.
   */
  contentClassName?: string;
  /**
   * Inline style on the dropdown content. Used to forward pending token-value
   * overrides (`--role: newValue`) so in-menu swatches reflect unsaved edits,
   * which the portal would otherwise miss (it sits outside the edit wrapper).
   */
  contentStyle?: React.CSSProperties;
}

/**
 * Searchable / scrollable combobox built on the frontend's Radix Popover — no
 * `cmdk` dependency, keeping `design-sdk` isolated. Type to filter, ↑/↓ to move,
 * Enter to pick, Esc to close. Used for both the semantic-token pickers and the
 * CVA-axis pickers in the right pane.
 */
export function Combobox({
  value,
  options,
  onChange,
  placeholder = 'Search…',
  ariaLabel,
  className,
  contentClassName,
  contentStyle,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => (o.label ?? o.value).toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  // Reset the query + highlight whenever the menu opens, and focus the input.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const selfIndex = Math.max(0, filtered.findIndex((o) => o.value === value));
    setActive(selfIndex);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted row in range as the filter narrows.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) commit(opt.value);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-xs',
            'outline-none transition-colors hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected?.adornment}
            <span className="truncate">{selected?.label ?? selected?.value ?? placeholder}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        style={contentStyle}
        matchTriggerWidth
        className={cn('min-w-52 overflow-hidden p-0', contentClassName)}
        /*
         * `onOpenAutoFocus={(e) => e.preventDefault()}` is gone, not forgotten: it existed
         * to stop Radix moving focus into the panel on open, and the local popover never
         * moves focus at all. The search input below focuses itself, which is the behaviour
         * that prop was protecting.
         */
      >
        <div className="border-b border-border p-1.5">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="w-full rounded-sm bg-transparent px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No matches.</p>
          )}
          {filtered.map((opt, i) => {
            const isSelected = opt.value === value;
            const isActive = i === active;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => commit(opt.value)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors',
                  isActive && 'bg-accent text-accent-foreground',
                  // Clear selected-state highlight, even when not keyboard-active.
                  isSelected && !isActive && 'bg-primary/10 font-medium text-primary',
                  !isActive && !isSelected && 'text-foreground',
                )}
              >
                {opt.adornment}
                <span className="min-w-0 flex-1 truncate">{opt.label ?? opt.value}</span>
                {isSelected && <Check className={cn('size-3.5 shrink-0', isActive ? 'opacity-70' : 'text-primary')} />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
