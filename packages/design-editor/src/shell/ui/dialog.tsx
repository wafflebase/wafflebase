/**
 * Dialog — local, for the same reason as `tabs`, `popover` and `select`.
 *
 * ONE instance in the whole shell: the review-and-approve modal. Measured, it uses six
 * parts (`Dialog`, `Content`, `Header`, `Title`, `Description`, `Footer`) exactly once
 * each. `@radix-ui/react-dialog` would be the right answer for a product surface and is
 * disproportionate for a single dev-tool modal, so the API is kept identical to shadcn's
 * and the implementation is ours.
 *
 * WHAT THIS DOES DO, because a modal that gets these wrong is worse than none: it renders
 * through a PORTAL (the panel tree it is declared in has `overflow` and a stacking
 * context), closes on Escape and on a backdrop click, and takes initial focus so the
 * keyboard lands inside it.
 *
 * NOT COVERED, said rather than implied: focus is not TRAPPED — Tab can walk out of the
 * dialog into the shell behind it — and `aria-modal` does not stop a screen reader from
 * reaching that content. Doing this properly is what Radix is for, and the day this shell
 * gains a second modal is the day to reach for it.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.ts';

const Ctx = createContext<{ titleId: string; descId: string } | null>(null);

function useDialog(part: string) {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error(`[design-editor] <${part}> must be inside <Dialog>`);
  return ctx;
}

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);

  // Split from the Escape listener below: `onOpenChange` is that effect's dependency, so
  // a caller passing an inline arrow would re-run it every parent render and pull focus
  // back off whatever the user was typing in. Focus is a once-per-open concern.
  // The panel, not the first control: the plan is the thing to read first, and landing on
  // "Approve" invites an Enter that writes files.
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onOpenChange]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      // Only a click that STARTED on the backdrop dismisses. Without the target check, a
      // drag that ends outside the panel — selecting text in the plan — closes the dialog
      // and discards what the user was reading.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <Ctx.Provider value={{ titleId: 'wb-dialog-title', descId: 'wb-dialog-desc' }}>
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="wb-dialog-title"
          aria-describedby="wb-dialog-desc"
          tabIndex={-1}
          className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 overflow-hidden rounded-lg border border-wb-border bg-wb-panel p-4 text-wb-fg shadow-xl outline-none"
        >
          {children}
        </div>
      </Ctx.Provider>
    </div>,
    document.body,
  );
}

export function DialogContent({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  // The panel above already IS the content box; this exists so the ported JSX nests as it
  // did, and it carries the scroll region.
  return <div className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}>{children}</div>;
}

export function DialogHeader({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn('flex shrink-0 flex-col gap-1', className)}>{children}</div>;
}

export function DialogTitle({ className, children }: { className?: string; children?: ReactNode }) {
  const { titleId } = useDialog('DialogTitle');
  return (
    <h2 id={titleId} className={cn('text-sm font-semibold', className)}>
      {children}
    </h2>
  );
}

export function DialogDescription({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { descId } = useDialog('DialogDescription');
  return (
    <p id={descId} className={cn('text-[11px] leading-relaxed text-wb-muted', className)}>
      {children}
    </p>
  );
}

export function DialogFooter({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn('flex shrink-0 items-center justify-end gap-2 pt-1', className)}>
      {children}
    </div>
  );
}
