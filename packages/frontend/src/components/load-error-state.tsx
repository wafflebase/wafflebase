import { RotateCw } from "lucide-react";
import { HttpError } from "@/api/http-error";
import { Button } from "@/components/ui/button";

/**
 * Full-panel error for a page whose primary query failed.
 *
 * A 403 / 404 is the server's answer, not a hiccup: offering a retry would
 * send someone back to something they cannot open, so when the caller
 * supplies `noAccessMessage` those statuses show it instead of the button.
 * Anything else gets the retry and no guessed cause — the client cannot tell
 * a dropped connection from a server error.
 */
export function LoadErrorState({
  title,
  error,
  onRetry,
  isRetrying = false,
  noAccessMessage,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
  isRetrying?: boolean;
  noAccessMessage?: string;
}) {
  const noAccess =
    noAccessMessage !== undefined &&
    error instanceof HttpError &&
    (error.status === 403 || error.status === 404);

  return (
    <div className="flex flex-col items-center justify-center gap-3 h-64">
      <div className="text-center">
        <p className="text-destructive text-lg">{title}</p>
        {noAccess && (
          <p className="text-sm text-muted-foreground">{noAccessMessage}</p>
        )}
      </div>
      {!noAccess && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={isRetrying}
        >
          <RotateCw className="mr-1 h-4 w-4" />
          {isRetrying ? "Trying again…" : "Try again"}
        </Button>
      )}
    </div>
  );
}
