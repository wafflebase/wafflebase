import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { WebhookTestResult } from "@/api/webhooks";
import { cn } from "@/lib/utils";
import { testResultLine } from "./webhook-copy";

/**
 * The outcome of a `webhook.test` ping, shown in place after a save or a
 * "Send test". A failure is a warning, never an error that blocks: someone
 * may register the endpoint before they have built the receiver.
 */
export function WebhookTestResultView({
  result,
  className,
}: {
  result: WebhookTestResult;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "space-y-2 rounded-md border p-3 text-sm",
        result.ok ? "border-success/40" : "border-warning/50",
        className,
      )}
    >
      <p
        className={cn(
          "flex items-start gap-2",
          result.ok ? "text-success" : "text-warning",
        )}
      >
        {result.ok ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        )}
        <span className="font-medium">
          {result.ok ? "Test event delivered" : "Test event not delivered"}
        </span>
      </p>
      <p className="text-foreground">{testResultLine(result)}</p>
      {!result.ok && (
        <p className="text-muted-foreground">
          The webhook is saved and active. Deliveries are retried for about a
          day, so you can finish the receiver first.
        </p>
      )}
      {result.responseExcerpt && (
        <pre className="max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
          {result.responseExcerpt}
        </pre>
      )}
    </div>
  );
}
