/**
 * Select — a native `<select>` wearing shadcn's API.
 *
 * §6 records this as "`SceneHost` alone has **25** `Select` call sites", which is what
 * `grep -o 'Select'` returns: it counts the import, the type, and every closing tag.
 * Measured, `SceneHost` has NINE `Select*` JSX tags and exactly ONE `<Select>` — the
 * zoom dropdown. A native `<select>` covers it completely, and it comes with the
 * keyboard model, the touch behaviour and the platform popup that a hand-rolled
 * listbox would have to reimplement badly.
 *
 * The shadcn shape is preserved so the ported call site is unchanged:
 *
 *     <Select value={String(zoom)} onValueChange={(v) => setZoom(Number(v))}>
 *       <SelectTrigger size="sm" className="…"><SelectValue /></SelectTrigger>
 *       <SelectContent>{ZOOMS.map((z) => <SelectItem value={String(z)}>…</SelectItem>)}</SelectContent>
 *     </Select>
 *
 * The trick is that `SelectContent`/`SelectItem` do not render themselves — they are
 * read as data. `Select` walks its descendants for `SelectItem`s and emits the
 * `<option>`s; the wrapper components exist so the JSX above compiles unchanged.
 * `SelectValue` renders nothing, because a native select already shows its value.
 *
 * WHAT IS LOST, said plainly: no per-option styling (a native `<option>` ignores most
 * CSS), and no rich content inside an option. Both are fine for "50% / 75% / 100%" and
 * neither is worth `@radix-ui/react-select` plus `lucide-react` in the shell bundle.
 */
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

interface ItemProps {
  value: string;
  children?: ReactNode;
}

/** Read as data by `Select`, never rendered. */
export function SelectItem(_props: ItemProps): null {
  return null;
}

/** A pass-through so the ported JSX nests as it did. */
export function SelectContent({ children }: { children?: ReactNode }): ReactNode {
  return children;
}

/** The trigger's props ARE the select's, so this only carries them upward. */
export function SelectTrigger(_props: {
  size?: 'sm' | 'default';
  className?: string;
  title?: string;
  children?: ReactNode;
}): null {
  return null;
}

/** A native select shows its own value. */
export function SelectValue(): null {
  return null;
}

/** Depth-first walk for `SelectItem`s, so `SelectContent` may wrap or `.map()` them. */
function collect(node: ReactNode, out: ItemProps[]): void {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === SelectItem) {
      out.push((child as ReactElement<ItemProps>).props);
      return;
    }
    collect((child.props as { children?: ReactNode }).children, out);
  });
}

/** The trigger carries the classes, so find it wherever it sits. */
function findTrigger(node: ReactNode): { className?: string; title?: string } | null {
  let found: { className?: string; title?: string } | null = null;
  Children.forEach(node, (child) => {
    if (found || !isValidElement(child)) return;
    if (child.type === SelectTrigger) {
      const p = (child as ReactElement<{ className?: string; title?: string }>).props;
      found = { className: p.className, title: p.title };
      return;
    }
    found = findTrigger((child.props as { children?: ReactNode }).children);
  });
  return found;
}

export function Select({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children?: ReactNode;
}) {
  const items: ItemProps[] = [];
  collect(children, items);
  const trigger = findTrigger(children);

  return (
    <select
      value={value}
      title={trigger?.title}
      onChange={(e) => onValueChange(e.target.value)}
      className={cn(
        'rounded border border-wb-border bg-wb-panel px-1.5 py-0.5 text-wb-fg',
        trigger?.className,
      )}
    >
      {items.map((it) => (
        <option key={it.value} value={it.value}>
          {it.children}
        </option>
      ))}
    </select>
  );
}
