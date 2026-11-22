import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isAuthExpiredError } from "@/api/auth";
import { userFacingError } from "@/api/http-error";
import {
  revealWebhookSecret,
  rotateWebhookSecret,
  type WebhookDetail,
} from "@/api/webhooks";
import { timeUntil } from "./webhook-copy";

/** Overlap choices for a rotation, in hours. 24 is the server's default. */
const OVERLAP_OPTIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

const MASK = "whsec_••••••••••••••••••••••••";

/**
 * The signing secret: masked until Reveal, copyable, and rotatable with an
 * overlap during which both secrets sign, so a receiver can be updated
 * without dropping a delivery. A second rotation inside the overlap is
 * refused by the server, so Rotate is disabled with the reason beside it.
 */
export function WebhookSecretSection({
  workspaceId,
  webhook,
  detailKey,
}: {
  workspaceId: string;
  webhook: WebhookDetail;
  detailKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const [overlapHours, setOverlapHours] = useState(24);

  const revealMutation = useMutation({
    mutationFn: () => revealWebhookSecret(workspaceId, webhook.id),
    onError: (error) => {
      if (isAuthExpiredError(error)) return;
      toast.error(userFacingError(error, "Couldn't reveal the secret"));
    },
  });

  const rotateMutation = useMutation({
    mutationFn: () => rotateWebhookSecret(workspaceId, webhook.id, overlapHours),
    onSuccess: (result) => {
      setSecret(result.secret);
      void queryClient.invalidateQueries({ queryKey: detailKey });
      toast.success("Secret rotated. Update your receiver with the new one.");
    },
    onError: (error) => {
      if (isAuthExpiredError(error)) return;
      toast.error(userFacingError(error, "Couldn't rotate the secret"));
    },
  });

  const reveal = async (): Promise<string | null> => {
    if (secret) return secret;
    try {
      const result = await revealMutation.mutateAsync();
      setSecret(result.secret);
      return result.secret;
    } catch {
      return null;
    }
  };

  const copy = async () => {
    const value = await reveal();
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast.success("Secret copied");
  };

  const overlapEnds =
    webhook.rotationExpiresAt &&
    new Date(webhook.rotationExpiresAt).getTime() > Date.now()
      ? webhook.rotationExpiresAt
      : null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Signing secret</h2>
        <p className="text-sm text-muted-foreground">
          Every request carries{" "}
          <code className="font-mono text-xs">webhook-signature</code>, an
          HMAC of its id, timestamp and body made with this secret. Check it
          before trusting a request.
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
        <code
          className="min-w-0 flex-1 font-mono text-sm break-all"
          aria-label={secret ? "Signing secret" : "Signing secret, hidden"}
        >
          {secret ?? MASK}
        </code>
        <Button
          variant="ghost"
          size="sm"
          aria-label={secret ? "Hide secret" : "Reveal secret"}
          disabled={revealMutation.isPending}
          onClick={() => (secret ? setSecret(null) : void reveal())}
        >
          {secret ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Copy secret"
          disabled={revealMutation.isPending}
          onClick={() => void copy()}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={String(overlapHours)}
          onValueChange={(v) => setOverlapHours(Number(v))}
          disabled={!!overlapEnds}
        >
          <SelectTrigger
            className="w-full sm:w-56"
            aria-label="Keep the previous secret working for"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OVERLAP_OPTIONS.map((o) => (
              <SelectItem key={o.hours} value={String(o.hours)}>
                Previous works for {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2 self-start sm:self-auto"
          disabled={!!overlapEnds || rotateMutation.isPending}
          aria-describedby={overlapEnds ? "rotation-overlap" : undefined}
          onClick={() => rotateMutation.mutate()}
        >
          <RefreshCw className="h-4 w-4" />
          Rotate secret
        </Button>
        {overlapEnds && (
          <p id="rotation-overlap" className="text-sm text-muted-foreground">
            Previous secret stops working in {timeUntil(overlapEnds)}.
          </p>
        )}
      </div>
    </section>
  );
}
