/**
 * Popover — local, for the same reason as `tabs.tsx`.
 *
 * Two instances in the whole shell: the stale-edit list and the write log. Both are
 * anchored to a small button in the header, both open downward-left, and neither needs
 * collision detection, portalling or focus trapping. `@radix-ui/react-popover` would
 * be the right answer for a product surface and is the wrong answer for two dev-tool
 * dropdowns.
 *
 * `asChild` IS SUPPORTED, because the ported call sites use it — they pass their own
 * `<button>` with its own classes and title. Implemented with `cloneElement` rather
 * than by rendering a wrapper, since a wrapper would break the header's flex layout
 * and change what the button's classes apply to.
 *
 * CLOSES ON OUTSIDE POINTERDOWN AND ON ESCAPE, and those are the two that matter: a
 * popover that survives a click elsewhere reads as a stuck editor. `pointerdown`
 * rather than `click` so it closes before the click lands on whatever is underneath —
 * otherwise dismissing it also activates something.
 *
 * NOT COVERED: focus is not trapped or restored, and the panel is positioned by CSS
 * `absolute` inside a `relative` wrapper rather than measured — so a popover near the
 * viewport edge can overflow. Both are real limits of this implementation and are
 * written here rather than left for a reader to discover.
 */
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.ts';

interface PopoverCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  id: string;
}

const Ctx = createContext<PopoverCtx | null>(null);

function usePopover(part: string): PopoverCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error(`[design-editor] <${part}> must be inside <Popover>`);
  return ctx;
}

export function Popover({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // `capture`, so a control that stops propagation cannot leave this open.
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <Ctx.Provider value={{ open, setOpen, id }}>
      <div ref={box} className="relative inline-flex">
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function PopoverTrigger({
  asChild,
  children,
}: {
  asChild?: boolean;
  children: ReactNode;
}) {
  const { open, setOpen, id } = usePopover('PopoverTrigger');
  const toggle = () => setOpen(!open);
  const shared = {
    'aria-expanded': open,
    'aria-controls': id,
    onClick: toggle,
  };

  if (asChild && isValidElement(children)) {
    // The call sites style their own button; cloning keeps those classes on the real
    // element instead of on a wrapper the header's flex layout would then see.
    const el = children as ReactElement<Record<string, unknown>>;
    return cloneElement(el, {
      ...shared,
      onClick: (e: React.MouseEvent) => {
        (el.props.onClick as ((e: React.MouseEvent) => void) | undefined)?.(e);
        toggle();
      },
    });
  }
  return (
    <button type="button" {...shared}>
      {children}
    </button>
  );
}

export function PopoverContent({
  className,
  align = 'end',
  children,
}: {
  className?: string;
  /** Which edge the panel lines up with. The header's popovers both open leftward. */
  align?: 'start' | 'end';
  children?: ReactNode;
}) {
  const { open, id } = usePopover('PopoverContent');
  if (!open) return null;
  return (
    <div
      id={id}
      role="dialog"
      className={cn(
        'absolute top-full z-50 mt-1 min-w-48 rounded-md border border-wb-border bg-wb-panel p-2 shadow-lg',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
