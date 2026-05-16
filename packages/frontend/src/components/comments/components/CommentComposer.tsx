import { useEffect, useLayoutEffect, useRef, useState, KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";

const MAX_TEXTAREA_HEIGHT_PX = 200;

type CommentComposerProps = {
  initialBody?: string;
  submitLabel: string;
  onSubmit: (body: string) => void | Promise<void>;
  onCancel?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /**
   * Compact variant for always-visible inline reply use case.
   * Smaller textarea, hides submit button until content is present,
   * matches the comment body font size for visual continuity.
   */
  compact?: boolean;
};

/**
 * Plain-text comment input form with submit/cancel actions. Used for
 * new threads and replies, by any consumer (docs, sheets, slides).
 *
 * Keyboard:
 * - Cmd/Ctrl+Enter: submit
 * - Escape: cancel (only when onCancel is provided)
 */
export function CommentComposer({
  initialBody = "",
  submitLabel,
  onSubmit,
  onCancel,
  disabled = false,
  autoFocus = false,
  compact = false,
}: CommentComposerProps) {
  const [body, setBody] = useState(initialBody);
  const trimmed = body.trim();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea. Reset to "auto" first so scrollHeight reflects
  // current content (otherwise the height never shrinks when lines are
  // deleted). Capped at MAX_TEXTAREA_HEIGHT_PX so a runaway paste does
  // not eat the popover.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT_PX);
    ta.style.height = `${next}px`;
    ta.style.overflowY =
      ta.scrollHeight > MAX_TEXTAREA_HEIGHT_PX ? "auto" : "hidden";
  }, [body]);

  // Force focus when requested. React's autoFocus is unreliable when the
  // popover opens from a Radix context-menu / dropdown: Radix uses its
  // own deferred focus restoration, which can outrun a single RAF. Two
  // RAFs + a 50ms fallback wins the race in practice.
  useEffect(() => {
    if (!autoFocus) return;
    let cancelled = false;
    const focusNow = () => {
      if (cancelled) return;
      const ta = textareaRef.current;
      if (!ta) return;
      if (document.activeElement !== ta) ta.focus();
    };
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(focusNow);
    });
    const timer = setTimeout(focusNow, 50);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      clearTimeout(timer);
    };
  }, [autoFocus]);

  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setBody("");
    } catch (err) {
      console.error("Failed to submit comment:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  const textareaClass = compact
    ? "flex w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
    : "flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none";

  return (
    <div className={compact ? "flex flex-col gap-1.5" : "flex flex-col gap-3"}>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKey}
        disabled={disabled}
        rows={compact ? 1 : 3}
        placeholder={
          disabled ? "Sign in to leave a comment." : "Add a comment..."
        }
        aria-label="Comment body"
        className={textareaClass}
      />
      {(!compact || trimmed.length > 0) && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size={compact ? "sm" : "default"}
              onClick={onCancel}
              disabled={disabled}
              className={compact ? "h-7 text-xs" : ""}
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size={compact ? "sm" : "default"}
            onClick={() => {
              void submit();
            }}
            disabled={disabled || submitting || !trimmed}
            className={compact ? "h-7 text-xs" : ""}
          >
            {submitLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
