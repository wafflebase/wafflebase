import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadErrorState } from "@/components/load-error-state";
import { isAuthExpiredError } from "@/api/auth";
import { userFacingError } from "@/api/http-error";
import { fetchWorkspace, type WorkspaceDetail } from "@/api/workspaces";
import {
  deleteWebhook,
  disableWebhook,
  enableWebhook,
  fetchWebhook,
  testWebhook,
  updateWebhook,
  WebhookUrlError,
  type WebhookDetail,
  type WebhookTestResult,
} from "@/api/webhooks";
import { disabledExplanation, urlErrorMessage } from "./webhook-copy";
import { WebhookFormFields } from "./webhook-form";
import {
  formProblem,
  formValuesFrom,
  recoverSinceFor,
  toWebhookInput,
  type RecoverChoice,
  type WebhookFormValues,
} from "./webhook-form-values";
import { WebhookTestResultView } from "./webhook-test-result";
import { WebhookSecretSection } from "./webhook-secret";
import { WebhookDeliveries } from "./webhook-deliveries";
import { WebhookStatusBadge } from "./webhooks-section";
import {
  WEBHOOKS_SECTION_ID,
  deliveriesQueryKey,
  webhooksQueryKey,
} from "./webhook-paths";

/**
 * `/w/:workspaceId/settings/webhooks/:webhookId` — the first sub-route under
 * settings. Configuration, the secret, the delivery log and the danger zone
 * do not fit in a settings section (docs/design/webhooks.md § User
 * experience). Owner-only: the server answers a member with 403/404, which
 * lands on the load-error state.
 */
export default function WebhookDetailPage() {
  const { workspaceId: workspaceRef, webhookId } = useParams<{
    workspaceId: string;
    webhookId: string;
  }>();

  // The route carries a slug; the webhook routes are keyed by the real id.
  const workspaceQuery = useQuery<WorkspaceDetail>({
    queryKey: ["workspaces", workspaceRef],
    queryFn: () => fetchWorkspace(workspaceRef!),
    enabled: !!workspaceRef,
  });
  const workspaceId = workspaceQuery.data?.id;
  const detailKey = ["workspaces", workspaceId, "webhooks", webhookId];

  const webhookQuery = useQuery<WebhookDetail>({
    queryKey: detailKey,
    queryFn: () => fetchWebhook(workspaceId!, webhookId!),
    enabled: !!workspaceId && !!webhookId,
  });

  const backHref = `/w/${encodeURIComponent(workspaceRef ?? "")}/settings#${WEBHOOKS_SECTION_ID}`;
  const failed = workspaceQuery.isError
    ? workspaceQuery
    : webhookQuery.isError
      ? webhookQuery
      : null;

  if (failed) {
    if (isAuthExpiredError(failed.error)) return null;
    return (
      <LoadErrorState
        title="Couldn't load the webhook."
        error={failed.error}
        onRetry={() => void failed.refetch()}
        isRetrying={failed.isFetching}
        noAccessMessage="This webhook doesn't exist, or only workspace owners can open it."
      />
    );
  }

  const webhook = webhookQuery.data;
  if (!webhook || !workspaceId) {
    return (
      <div className="max-w-3xl space-y-6 p-4 lg:p-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <WebhookDetailView
      workspaceId={workspaceId}
      webhook={webhook}
      detailKey={detailKey}
      backHref={backHref}
    />
  );
}

function WebhookDetailView({
  workspaceId,
  webhook,
  detailKey,
  backHref,
}: {
  workspaceId: string;
  webhook: WebhookDetail;
  detailKey: readonly unknown[];
  backHref: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<WebhookTestResult | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const refresh = (next?: WebhookDetail) => {
    if (next) queryClient.setQueryData(detailKey, next);
    void queryClient.invalidateQueries({
      queryKey: webhooksQueryKey(workspaceId),
      exact: true,
    });
  };

  const testMutation = useMutation({
    mutationFn: () => testWebhook(workspaceId, webhook.id),
    onSuccess: (result) => {
      setTestResult(result);
      void queryClient.invalidateQueries({
        queryKey: deliveriesQueryKey(workspaceId, webhook.id),
      });
    },
    onError: (error) => {
      if (isAuthExpiredError(error)) return;
      toast.error(userFacingError(error, "Couldn't send the test event"));
    },
  });

  const disableMutation = useMutation({
    mutationFn: () => disableWebhook(workspaceId, webhook.id),
    onSuccess: (next) => {
      refresh(next);
      toast.success("Webhook turned off");
    },
    onError: (error) => {
      if (isAuthExpiredError(error)) return;
      toast.error(userFacingError(error, "Couldn't turn the webhook off"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteWebhook(workspaceId, webhook.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: detailKey });
      refresh();
      toast.success("Webhook deleted");
      navigate(backHref, { replace: true });
    },
    onError: (error) => {
      if (isAuthExpiredError(error)) return;
      toast.error(userFacingError(error, "Couldn't delete the webhook"));
    },
  });

  return (
    <div className="max-w-3xl space-y-8 p-4 lg:p-6">
      <div className="space-y-3">
        <Link
          to={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Webhooks
        </Link>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold">{webhook.name}</h1>
              <WebhookStatusBadge
                status={webhook.status}
                reason={webhook.disabledReason}
              />
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {webhook.host}
              {webhook.createdBy && <> · owned by {webhook.createdBy.username}</>}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
              disabled={testMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              <Send className="h-4 w-4" />
              {testMutation.isPending ? "Sending…" : "Send test"}
            </Button>
            {webhook.status === "active" && (
              <Button
                variant="outline"
                size="sm"
                disabled={disableMutation.isPending}
                onClick={() => disableMutation.mutate()}
              >
                Turn off
              </Button>
            )}
          </div>
        </div>
        {testResult && <WebhookTestResultView result={testResult} />}
      </div>

      {webhook.status === "disabled" && (
        <DisabledBanner
          workspaceId={workspaceId}
          webhook={webhook}
          onEnabled={refresh}
        />
      )}

      <ConfigSection
        workspaceId={workspaceId}
        webhook={webhook}
        onSaved={refresh}
      />

      <Separator />
      <WebhookSecretSection
        workspaceId={workspaceId}
        webhook={webhook}
        detailKey={detailKey}
      />

      <Separator />
      <WebhookDeliveries workspaceId={workspaceId} webhookId={webhook.id} />

      <Separator />
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
        <div className="rounded-md border border-destructive/30 p-4">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Delete this webhook</p>
              <p className="text-sm text-muted-foreground">
                Nothing more is sent, and its delivery log is deleted with it.
              </p>
            </div>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete webhook
            </Button>
          </div>
        </div>
      </section>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete webhook</DialogTitle>
            <DialogDescription>
              <strong>{webhook.name}</strong> stops receiving events from this
              workspace, and its delivery log is deleted. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Name, URL, events and folders, saved together. Changing the URL sends a
 * fresh test ping, shown in place; a failure is a warning, not a revert.
 */
function ConfigSection({
  workspaceId,
  webhook,
  onSaved,
}: {
  workspaceId: string;
  webhook: WebhookDetail;
  onSaved: (next: WebhookDetail) => void;
}) {
  const [values, setValues] = useState<WebhookFormValues>(() =>
    formValuesFrom(webhook),
  );
  const [urlError, setUrlError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<WebhookTestResult | null>(null);

  // Another tab, or the secret section, refetched the webhook: pick up its
  // saved values unless this form has unsaved edits.
  const savedKey = `${webhook.name}\n${webhook.url}\n${webhook.events.join()}\n${webhook.folderIds.join()}`;
  const [baseKey, setBaseKey] = useState(savedKey);
  useEffect(() => {
    if (savedKey === baseKey) return;
    setBaseKey(savedKey);
    setValues(formValuesFrom(webhook));
  }, [savedKey, baseKey, webhook]);

  const base = toWebhookInput(formValuesFrom(webhook), webhook);
  const next = toWebhookInput(values, webhook);
  const dirty = JSON.stringify(base) !== JSON.stringify(next);
  const problem = formProblem(values);

  const saveMutation = useMutation({
    mutationFn: () => {
      // Send only what changed, so a URL left alone sends no test ping.
      const patch: Partial<typeof next> = {};
      (Object.keys(next) as Array<keyof typeof next>).forEach((k) => {
        if (JSON.stringify(next[k]) !== JSON.stringify(base[k])) {
          (patch as Record<string, unknown>)[k] = next[k];
        }
      });
      return updateWebhook(workspaceId, webhook.id, patch);
    },
    onSuccess: (result) => {
      setTestResult(result.test);
      onSaved(result.webhook);
      toast.success("Webhook saved");
    },
    onError: (error) => {
      // Before the auth check: that guard narrows `error` structurally.
      if (error instanceof WebhookUrlError) {
        setUrlError(urlErrorMessage(error.code, error.address, error.message));
        return;
      }
      if (isAuthExpiredError(error)) return;
      toast.error(userFacingError(error, "Couldn't save the webhook"));
    },
  });

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Configuration</h2>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!dirty || problem || saveMutation.isPending) return;
          setUrlError(null);
          saveMutation.mutate();
        }}
      >
        <WebhookFormFields
          workspaceId={workspaceId}
          values={values}
          onChange={(v) => {
            if (v.url !== values.url) setUrlError(null);
            setValues(v);
          }}
          urlError={urlError}
          idPrefix="edit-webhook"
        />
        {testResult && <WebhookTestResultView result={testResult} />}
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            variant="outline"
            disabled={!dirty || !!problem || saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
          {dirty && problem && (
            <p className="text-sm text-muted-foreground">{problem}</p>
          )}
        </div>
      </form>
    </section>
  );
}

/**
 * Why it is off, in words, and Re-enable with the "recover since" choice:
 * re-send what failed from when it was turned off (the default), from when
 * the failures began, or nothing. Re-enabling records the caller as the new
 * owner, which is how another owner takes over a `creator_removed` webhook.
 */
function DisabledBanner({
  workspaceId,
  webhook,
  onEnabled,
}: {
  workspaceId: string;
  webhook: WebhookDetail;
  onEnabled: (next: WebhookDetail) => void;
}) {
  const [choice, setChoice] = useState<RecoverChoice>(
    webhook.disabledAt ? "disabled" : "none",
  );
  const failingEarlier =
    !!webhook.failingSince &&
    (!webhook.disabledAt || webhook.failingSince < webhook.disabledAt);

  const enableMutation = useMutation({
    mutationFn: () =>
      enableWebhook(
        workspaceId,
        webhook.id,
        recoverSinceFor(choice, webhook),
      ),
    onSuccess: (next) => {
      onEnabled(next);
      toast.success("Webhook re-enabled");
    },
    onError: (error) => {
      if (isAuthExpiredError(error)) return;
      toast.error(userFacingError(error, "Couldn't turn the webhook on"));
    },
  });

  return (
    <div
      role="alert"
      className="space-y-3 rounded-md border border-warning/50 p-4"
    >
      <p className="flex items-start gap-2 text-sm">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
          aria-hidden
        />
        <span>{disabledExplanation(webhook)}</span>
      </p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          When it's back on, send again what failed
        </legend>
        <RadioGroup
          value={choice}
          onValueChange={(v) => setChoice(v as RecoverChoice)}
        >
          {webhook.disabledAt && (
            <div className="flex items-center gap-2">
              <RadioGroupItem value="disabled" id="recover-disabled" />
              <Label htmlFor="recover-disabled" className="font-normal">
                Since it was turned off (
                {new Date(webhook.disabledAt).toLocaleString()})
              </Label>
            </div>
          )}
          {failingEarlier && (
            <div className="flex items-center gap-2">
              <RadioGroupItem value="failing" id="recover-failing" />
              <Label htmlFor="recover-failing" className="font-normal">
                Since failures began (
                {new Date(webhook.failingSince!).toLocaleString()})
              </Label>
            </div>
          )}
          <div className="flex items-center gap-2">
            <RadioGroupItem value="none" id="recover-none" />
            <Label htmlFor="recover-none" className="font-normal">
              Nothing, only new events
            </Label>
          </div>
        </RadioGroup>
      </fieldset>
      <Button
        variant="outline"
        size="sm"
        disabled={enableMutation.isPending}
        onClick={() => enableMutation.mutate()}
      >
        Re-enable
      </Button>
    </div>
  );
}
