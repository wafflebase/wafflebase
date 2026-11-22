import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { isAuthExpiredError } from "@/api/auth";
import { userFacingError } from "@/api/http-error";
import {
  createWebhook,
  WebhookUrlError,
  type WebhookDetail,
  type WebhookTestResult,
} from "@/api/webhooks";
import { urlErrorMessage } from "./webhook-copy";
import { WebhookFormFields } from "./webhook-form";
import {
  emptyFormValues,
  formProblem,
  toWebhookInput,
  type WebhookFormValues,
} from "./webhook-form-values";
import { WebhookTestResultView } from "./webhook-test-result";

/**
 * Add-webhook dialog. Saving creates the webhook and sends it a test ping;
 * the dialog then turns into the ping's result rather than closing, because
 * that result is the first thing the owner wants to know. A failed ping is a
 * warning beside a saved webhook, not a blocked form.
 */
export function CreateWebhookDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
  onOpenDetail,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onOpenDetail: (webhookId: string) => void;
}) {
  const [values, setValues] = useState<WebhookFormValues>(emptyFormValues);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{
    webhook: WebhookDetail;
    test: WebhookTestResult;
  } | null>(null);

  const reset = () => {
    setValues(emptyFormValues());
    setUrlError(null);
    setSaved(null);
  };

  const createMutation = useMutation({
    mutationFn: () => createWebhook(workspaceId, toWebhookInput(values)),
    onSuccess: (result) => {
      setSaved(result);
      onCreated();
    },
    onError: (error) => {
      // Before the auth check: that guard narrows `error` structurally.
      if (error instanceof WebhookUrlError) {
        setUrlError(urlErrorMessage(error.code, error.address, error.message));
        return;
      }
      if (isAuthExpiredError(error)) return;
      toast.error(userFacingError(error, "Couldn't create the webhook"));
    },
  });

  const problem = formProblem(values);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {saved ? (
          <>
            <DialogHeader>
              <DialogTitle>Webhook added</DialogTitle>
              <DialogDescription>
                We sent {saved.webhook.host} a signed test event.
              </DialogDescription>
            </DialogHeader>
            <WebhookTestResultView result={saved.test} />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenDetail(saved.webhook.id)}
              >
                View signing secret
              </Button>
              <Button
                onClick={() => {
                  onOpenChange(false);
                  reset();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (problem || createMutation.isPending) return;
              setUrlError(null);
              createMutation.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Add webhook</DialogTitle>
              <DialogDescription>
                Workspace events are sent as signed POST requests to your URL.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <WebhookFormFields
                workspaceId={workspaceId}
                values={values}
                onChange={(next) => {
                  if (next.url !== values.url) setUrlError(null);
                  setValues(next);
                }}
                urlError={urlError}
                idPrefix="create-webhook"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  reset();
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!!problem || createMutation.isPending}
                title={problem ?? undefined}
              >
                {createMutation.isPending ? "Saving…" : "Save and send test"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
