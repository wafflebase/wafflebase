import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn.ts';

/**
 * Minimal, dependency-free accordion. One controlled-open section with an
 * animated chevron. We hand-roll it (rather than pull in `@radix-ui/react-accordion`)
 * to keep this package's zero-new-dependency guarantee — the published
 * `@wafflebase/design-editor` declares no runtime dependency at all.
 */
export function AccordionSection({
  title,
  icon,
  count,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  right,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  /**
   * Controlled open state. Pass this (with `onOpenChange`) when something outside
   * the header has to expand the section — the per-section "Add" button opens it
   * before revealing the draft row, so the new input is never hidden.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional trailing control (e.g. an "Add" button) rendered in the header. */
  right?: ReactNode;
  children: ReactNode;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const setOpen = (next: boolean) => {
    setUncontrolled(next);
    onOpenChange?.(next);
  };
  return (
    <section className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center bg-muted/40">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1.5 px-2.5 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          {icon}
          <span>{title}</span>
          {typeof count === 'number' && (
            <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </button>
        {right && <div className="pr-2">{right}</div>}
      </div>
      {open && <div className="p-2">{children}</div>}
    </section>
  );
}
