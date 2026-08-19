/**
 * Tabs — local, not the consumer's shadcn component.
 *
 * WHY NOT VENDOR RADIX. §6 says the chrome imports `@/components/ui/tabs` from the
 * consumer, and that reads as "the shell needs their component library". Measured,
 * the whole tab surface of this shell is ONE `Tabs` holding THREE triggers. Pulling
 * `@radix-ui/react-tabs` into the shell bundle for that is disproportionate, and this
 * is our chrome — it owes the consumer's design system nothing.
 *
 * The API is kept identical to shadcn's on purpose (`defaultValue`, `value`,
 * `TabsTrigger value`, `TabsContent value`) so the ported layout does not have to be
 * rewritten around it, and so a later swap back to Radix would be a one-line import
 * change if a panel ever needs something this cannot do.
 *
 * `data-state="active" | "inactive"` is emitted because the ported call sites style
 * on `data-[state=active]:…`. Those Tailwind selectors are compiled into the shell
 * bundle, so they have to match what a trigger actually renders.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. No roving-tabindex keyboard model, no
 * `aria-controls` wiring to panel ids. Three buttons in a dev-only tool reachable by
 * Tab and Enter is honest; claiming a full ARIA tablist while implementing half of one
 * would be worse than not claiming it. Recorded here rather than implied.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

interface TabsCtx {
  value: string;
  select: (v: string) => void;
}

const Ctx = createContext<TabsCtx | null>(null);

/** Throws rather than rendering nothing: a tab part outside its `Tabs` is a bug. */
function useTabs(part: string): TabsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error(`[design-editor] <${part}> must be inside <Tabs>`);
  return ctx;
}

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  className,
  children,
}: {
  defaultValue?: string;
  /** Controlled mode. Omit for `defaultValue`, which is what the layout uses. */
  value?: string;
  onValueChange?: (v: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  const [own, setOwn] = useState(defaultValue ?? '');
  const active = value ?? own;
  const ctx = useMemo<TabsCtx>(
    () => ({
      value: active,
      select: (v) => {
        if (value === undefined) setOwn(v);
        onValueChange?.(v);
      },
    }),
    [active, value, onValueChange],
  );
  return (
    <Ctx.Provider value={ctx}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-wb-border bg-wb-panel p-0.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children?: ReactNode;
}) {
  const { value: active, select } = useTabs('TabsTrigger');
  const on = active === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      data-state={on ? 'active' : 'inactive'}
      onClick={() => select(value)}
      className={cn(
        'rounded px-2 py-1 text-xs text-wb-muted transition-colors hover:text-wb-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  style,
  children,
}: {
  value: string;
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
}) {
  const { value: active } = useTabs('TabsContent');
  // Unmounted, not hidden. A hidden panel keeps measuring and painting — and the
  // panels this will hold render scene outlines and token previews, which is exactly
  // the work not to do for a tab nobody is looking at.
  if (active !== value) return null;
  return (
    <div role="tabpanel" className={className} style={style}>
      {children}
    </div>
  );
}
