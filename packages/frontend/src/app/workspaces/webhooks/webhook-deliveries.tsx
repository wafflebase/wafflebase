import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Copy, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { isAuthExpiredError } from "@/api/auth";
import { userFacingError } from "@/api/http-error";
import {
  fetchWebhookDeliveries,
  fetchWebhookDelivery,
  redeliverWebhookDelivery,
  type DeliveryDetail,
  type DeliveryPage,
  type DeliverySummary,
} from "@/api/webhooks";
import { cn } from "@/lib/utils";
import { formatDuration, timeAgo } from "./webhook-copy";
import { deliveriesQueryKey } from "./webhook-paths";

const PAGE_SIZE = 25;

/**
 * The delivery log, the debugging surface: one row per event sent, newest
 * first, with the response that came back. A row expands to the exact
 * payload and response excerpt, and Redeliver pulls its next attempt to now
 * (same delivery id, so a receiver deduplicating on `webhook-id` sees one
 * event). Rows become cards below `sm`.
 */
export function WebhookDeliveries({
  workspaceId,
  webhookId,
}: {
  workspaceId: string;
  webhookId: string;
}) {
  const [failedOnly, setFailedOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const status = failedOnly ? "failed" : "all";
  const queryKey = [...deliveriesQueryKey(workspaceId, webhookId), status];

  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<DeliveryPage>({
    queryKey,
    queryFn: ({ pageParam }) =>
      fetchWebhookDeliveries(workspaceId, webhookId, {
        status,
        cursor: pageParam as DeliveryPage["nextCursor"],
        limit: PAGE_SIZE,
      }),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const deliveries = data?.pages.flatMap((p) => p.deliveries) ?? [];

  return (
    <section className="space-y-3">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Deliveries</h2>
          <p className="text-sm text-muted-foreground">
            Kept for 30 days. Failed deliveries are retried for about a day.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="deliveries-failed-only"
              checked={failedOnly}
              onCheckedChange={(c) => {
                setFailedOnly(c === true);
                setExpanded(null);
              }}
            />
            <Label htmlFor="deliveries-failed-only" className="font-normal">
              Failed only
            </Label>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Refresh deliveries"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RotateCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3 rounded-md border p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : isError && !data ? (
        <p className="text-sm text-muted-foreground">
          Couldn't load deliveries.{" "}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </p>
      ) : deliveries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {failedOnly ? "No failed deliveries." : "Nothing sent yet."}
        </p>
      ) : (
        <div className="rounded-md border">
          <div
            className="hidden grid-cols-[1.5rem_minmax(0,1fr)_5rem_4.5rem_7rem_5rem] gap-3 border-b px-3 py-2 text-xs font-medium text-muted-foreground sm:grid"
            aria-hidden
          >
            <span />
            <span>Event</span>
            <span>Status</span>
            <span>Attempts</span>
            <span>Next retry</span>
            <span className="text-right">Duration</span>
          </div>
          <ul className="divide-y">
            {deliveries.map((delivery) => (
              <DeliveryRow
                key={delivery.id}
                workspaceId={workspaceId}
                webhookId={webhookId}
                delivery={delivery}
                open={expanded === delivery.id}
                onToggle={() =>
                  setExpanded((id) => (id === delivery.id ? null : delivery.id))
                }
              />
            ))}
          </ul>
        </div>
      )}

      {hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}

function DeliveryRow({
  workspaceId,
  webhookId,
  delivery,
  open,
  onToggle,
}: {
  workspaceId: string;
  webhookId: string;
  delivery: DeliverySummary;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `delivery-${delivery.id}`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grid-cols-[1.5rem_minmax(0,1fr)_5rem_4.5rem_7rem_5rem]"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0">
          <span className="block truncate font-mono text-xs">
            {delivery.eventType}
          </span>
          <span className="block text-xs text-muted-foreground">
            {timeAgo(delivery.createdAt)}
          </span>
        </span>
        <DeliveryStatus delivery={delivery} />
        {/* Below `sm` the remaining facts wrap to a second line of the card. */}
        <span className="col-start-2 text-xs text-muted-foreground tabular-nums sm:col-start-auto sm:text-sm">
          <span className="sm:hidden">Attempts </span>
          {delivery.attempts}
        </span>
        <span className="col-start-2 text-xs text-muted-foreground tabular-nums sm:col-start-auto sm:text-sm">
          <NextRetry delivery={delivery} />
        </span>
        <span className="col-start-2 text-xs text-muted-foreground tabular-nums sm:col-start-auto sm:text-right sm:text-sm">
          {delivery.lastDurationMs === null
            ? "—"
            : formatDuration(delivery.lastDurationMs)}
        </span>
      </button>
      {open && (
        <div id={panelId} className="border-t bg-muted/40 px-3 py-3">
          <DeliveryDetailPanel
            workspaceId={workspaceId}
            webhookId={webhookId}
            delivery={delivery}
          />
        </div>
      )}
    </li>
  );
}

function DeliveryStatus({ delivery }: { delivery: DeliverySummary }) {
  const code = delivery.lastStatus;
  if (delivery.status === "delivered") {
    return (
      <Badge variant="secondary" className="tabular-nums">
        {code ?? "OK"}
      </Badge>
    );
  }
  if (delivery.status === "failed") {
    return (
      <Badge variant="destructive" className="tabular-nums">
        {code ?? "Failed"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground tabular-nums">
      {code ?? (delivery.status === "in_flight" ? "Sending" : "Pending")}
    </Badge>
  );
}

function NextRetry({ delivery }: { delivery: DeliverySummary }) {
  const pending =
    delivery.status === "pending" || delivery.status === "in_flight";
  if (!pending || delivery.attempts === 0) {
    return <span aria-label="No retry scheduled">—</span>;
  }
  const at = new Date(delivery.nextAttemptAt);
  const inPast = at.getTime() <= Date.now();
  return (
    <span title={at.toLocaleString()}>
      <span className="sm:hidden">Retry </span>
      {inPast
        ? "now"
        : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

function DeliveryDetailPanel({
  workspaceId,
  webhookId,
  delivery,
}: {
  workspaceId: string;
  webhookId: string;
  delivery: DeliverySummary;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<DeliveryDetail>({
    queryKey: [
      ...deliveriesQueryKey(workspaceId, webhookId),
      "detail",
      delivery.id,
    ],
    queryFn: () => fetchWebhookDelivery(workspaceId, webhookId, delivery.id),
  });

  const redeliverMutation = useMutation({
    mutationFn: () =>
      redeliverWebhookDelivery(workspaceId, webhookId, delivery.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: deliveriesQueryKey(workspaceId, webhookId),
      });
      toast.success("Queued to send again");
    },
    onError: (error) => {
      if (isAuthExpiredError(error)) return;
      toast.error(userFacingError(error, "Couldn't redeliver"));
    },
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (isError || !data) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn't load this delivery.
      </p>
    );
  }

  const payload = JSON.stringify(data.payload, null, 2);

  return (
    <div className="space-y-3">
      {data.lastError && (
        <p className="text-sm text-destructive [overflow-wrap:anywhere]">
          {data.lastError}
        </p>
      )}
      <CopyableBlock label="Payload" text={payload} />
      <CopyableBlock
        label="Response"
        text={data.responseExcerpt}
        empty="No response body."
      />
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={
            redeliverMutation.isPending || delivery.status === "in_flight"
          }
          onClick={() => redeliverMutation.mutate()}
        >
          Redeliver
        </Button>
        <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
          webhook-id {delivery.id}
        </span>
      </div>
    </div>
  );
}

function CopyableBlock({
  label,
  text,
  empty,
}: {
  label: string;
  text: string | null;
  empty?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {text && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={() => {
              void navigator.clipboard.writeText(text);
              toast.success(`${label} copied`);
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {text ? (
        <pre className="max-h-64 overflow-auto rounded border bg-background p-2 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
          {text}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
