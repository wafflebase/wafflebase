import { useState, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";

type CommentComposerProps = {
  initialBody?: string;
  submitLabel: string;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

/**
 * Reusable plain-text comment input form with submit/cancel actions.
 * Used for both new threads and replies.
 *
 * Keyboard shortcuts:
 * - Cmd/Ctrl+Enter: submit
 * - Escape: cancel (only if onCancel is provided)
 */
export function CommentComposer({
  initialBody = "",
  submitLabel,
  onSubmit,
  onCancel,
  disabled = false,
  autoFocus = false,
}: CommentComposerProps) {
  const [body, setBody] = useState(initialBody);
  const trimmed = body.trim();

  const submit = () => {
    if (!trimmed) return;
    onSubmit(body);
    setBody("");
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKey}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={3}
        placeholder={
          disabled ? "Sign in to leave a comment." : "Add a comment..."
        }
        aria-label="Comment body"
        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={disabled}
          >
            Cancel
          </Button>
        )}
        <Button
          type="button"
          onClick={submit}
          disabled={disabled || !trimmed}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
