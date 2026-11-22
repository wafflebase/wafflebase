import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, Webhook } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchWebhooks,
  type WebhookList,
  type WebhookSummary,
} from "@/api/webhooks";
import { statusLabel, timeAgo } from "./webhook-copy";
import { describeEvents } from "./webhook-events";
import { CreateWebhookDialog } from "./create-webhook-dialog";
import {
  WEBHOOKS_SECTION_ID,
  webhookDetailPath,
  webhooksQueryKey,
} from "./webhook-paths";

/**
 * Workspace settings section listing where workspace events are sent.
 *
 * Owners manage; members see the list read-only, host only — where workspace
 * data leaves to is something members are entitled to know, but the full URL
 * is often itself a secret (docs/design/webhooks.md § Ownership).
 *
 * `workspaceId` is the workspace's real id; `workspaceRef` is whatever the
 * route carries (usually the slug), used for links.
 */
export function WorkspaceWebhooksSection({
  workspaceId,
  workspaceRef,
}: {
  workspaceId: string;
  workspaceRef: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const queryKey = webhooksQueryKey(workspaceId);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<WebhookList>({
      queryKey,
      queryFn: () => fetchWebhooks(workspaceId),
    });

  const canManage = !!data?.canManage;
  const enabled = data?.enabled ?? true;

  return (
    <section id={WEBHOOKS_SECTION_ID} className="scroll-mt-4 space-y-2">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Webhooks</h2>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "Send workspace events to another service as they happen. Only owners can add or change webhooks."
              : "Services this workspace sends its events to. Only owners can add or change them."}
          </p>
        </div>
        {/* Outline, like Data sources: "Create invite link" stays the
            page's one primary action (DESIGN.md, the One Accent Rule). */}
        {canManage && enabled && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowCreate(true)}
            className="flex shrink-0 items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add webhook
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3 rounded-md border p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : isError && !data ? (
        <p className="text-sm text-muted-foreground">
          Couldn't load webhooks.{" "}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </p>
      ) : !data ? null : !data.enabled ? (
        // Shown, muted, rather than hidden: on a self-hosted install the
        // owner is often the operator, and a hidden section is an
        // undiscoverable one.
        <p className="text-sm text-muted-foreground">
          {canManage ? (
            <>
              Webhooks are off on this server. An administrator can enable
              them with{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                WAFFLEBASE_WEBHOOKS_ENABLED=true
              </code>
              .
            </>
          ) : (
            "Webhooks are off on this server."
          )}
        </p>
      ) : data.webhooks.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {data.webhooks.map((webhook) => (
            <WebhookRow
              key={webhook.id}
              webhook={webhook}
              href={
                canManage ? webhookDetailPath(workspaceRef, webhook.id) : null
              }
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No webhooks.</p>
      )}

      {canManage && (
        <CreateWebhookDialog
          workspaceId={workspaceId}
          open={showCreate}
          onOpenChange={setShowCreate}
          onCreated={() => void queryClient.invalidateQueries({ queryKey })}
          onOpenDetail={(id) => {
            setShowCreate(false);
            navigate(webhookDetailPath(workspaceRef, id));
          }}
        />
      )}
    </section>
  );
}

/**
 * One webhook: name, host, status, last delivery. A list rather than a
 * table, like Data sources, so a long host cannot push the status off a
 * phone-width screen. Members get the same row without a link.
 */
function WebhookRow({
  webhook,
  href,
}: {
  webhook: WebhookSummary;
  href: string | null;
}) {
  const body = (
    <>
      <Webhook
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{webhook.name}</span>
          <WebhookStatusBadge
            status={webhook.status}
            reason={webhook.disabledReason}
          />
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {webhook.host}
          <span aria-hidden> · </span>
          {describeEvents(webhook.events)}
        </p>
      </div>
      <LastDelivery webhook={webhook} />
      {href && (
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
    </>
  );
  return (
    <li>
      {href ? (
        <Link
          to={href}
          className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">{body}</div>
      )}
    </li>
  );
}

export function WebhookStatusBadge({
  status,
  reason,
}: {
  status: WebhookSummary["status"];
  reason: WebhookSummary["disabledReason"];
}) {
  return (
    <Badge
      variant={status === "active" ? "secondary" : "outline"}
      className={status === "active" ? undefined : "text-muted-foreground"}
    >
      {statusLabel(status, reason)}
    </Badge>
  );
}

function LastDelivery({ webhook }: { webhook: WebhookSummary }) {
  if (!webhook.lastDeliveryAt) {
    return (
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        No deliveries yet
      </span>
    );
  }
  const status = webhook.lastDeliveryStatus;
  const ok = status !== null && status >= 200 && status < 300;
  return (
    <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
      <span className={ok ? undefined : "text-destructive"}>
        {status ?? "No response"}
      </span>
      <span className="hidden sm:inline">
        {" "}
        · {timeAgo(webhook.lastDeliveryAt)}
      </span>
    </span>
  );
}
