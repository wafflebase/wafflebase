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
import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

interface PopoverCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  id: string;
  /** The trigger's measured width, so a panel can match it. See `PopoverContent`. */
  triggerWidth: number | null;
  measure: (el: HTMLElement | null) => void;
}

const Ctx = createContext<PopoverCtx | null>(null);

function usePopover(part: string): PopoverCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error(`[design-editor] <${part}> must be inside <Popover>`);
  return ctx;
}

export function Popover({
  open: openProp,
  onOpenChange,
  children,
}: {
  /**
   * CONTROLLED MODE, added for `Combobox`, which opens on a keystroke and closes on a
   * commit — neither of which is a click on the trigger. Omit both props for the
   * uncontrolled behaviour the header's two popovers use.
   */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  children?: ReactNode;
}) {
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const setOpen = useCallback(
    (v: boolean) => {
      if (openProp === undefined) setOwn(v);
      onOpenChange?.(v);
    },
    [openProp, onOpenChange],
  );
  const [triggerWidth, setTriggerWidth] = useState<number | null>(null);
  /**
   * MEMOISED, and the cost of not doing so was measured rather than assumed. A ref
   * callback whose identity changes is detached and reattached by React on every render,
   * and this one reads layout: 60 parent renders produced 60 `getBoundingClientRect()`
   * calls, one per render, per popover. `App` re-renders on `onHover` while the pointer
   * moves over the frame and holds three popovers, so that is ~3 forced layout reads per
   * pointer event — free in jsdom, not in a browser.
   */
  const measure = useCallback(
    (el: HTMLElement | null) =>
      setTriggerWidth(el ? Math.round(el.getBoundingClientRect().width) : null),
    [],
  );
  const id = useId();
  const box = useRef<HTMLDivElement | null>(null);
  // The provider value too: a fresh object re-renders every consumer regardless of the
  // callbacks above being stable.
  const ctx = useMemo(
    () => ({ open, setOpen, id, triggerWidth, measure }),
    [open, setOpen, id, triggerWidth, measure],
  );

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
    // `setOpen` is a `useCallback`, so listing it costs no extra runs and makes the effect
    // honest about what it closes over.
  }, [open, setOpen]);

  return (
    <Ctx.Provider value={ctx}>
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
  const { open, setOpen, id, measure } = usePopover('PopoverTrigger');
  const toggle = () => setOpen(!open);
  // A ref callback rather than a layout effect: the trigger is the only element that
  // knows its own width, and it is measured when it mounts and whenever it is replaced.
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
      ref: measure,
      onClick: (e: React.MouseEvent) => {
        (el.props.onClick as ((e: React.MouseEvent) => void) | undefined)?.(e);
        toggle();
      },
    });
  }
  return (
    <button type="button" ref={measure} {...shared}>
      {children}
    </button>
  );
}

export function PopoverContent({
  className,
  align = 'end',
  label,
  sideOffset,
  style,
  matchTriggerWidth,
  children,
}: {
  className?: string;
  /** Which edge the panel lines up with. The header's popovers both open leftward. */
  align?: 'start' | 'end';
  /** The dialog's accessible name — without one it is announced as a bare "dialog". */
  label?: string;
  /** Gap below the trigger, in px. Defaults to the `mt-1` the header uses. */
  sideOffset?: number;
  style?: React.CSSProperties;
  /**
   * Make the panel at least as wide as its trigger — what Radix exposes as
   * `--radix-popover-trigger-width`. `Combobox` needs it: a dropdown narrower than the
   * control it belongs to reads as a detached menu.
   */
  matchTriggerWidth?: boolean;
  children?: ReactNode;
}) {
  const { open, id, triggerWidth } = usePopover('PopoverContent');
  if (!open) return null;
  return (
    <div
      id={id}
      role="dialog"
      aria-label={label}
      style={{
        ...(sideOffset === undefined ? null : { marginTop: sideOffset }),
        ...(matchTriggerWidth && triggerWidth ? { minWidth: triggerWidth } : null),
        ...style,
      }}
      className={cn(
        'absolute top-full z-50 min-w-48 rounded-md border border-wb-border bg-wb-panel p-2 shadow-lg',
        sideOffset === undefined && 'mt-1',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
