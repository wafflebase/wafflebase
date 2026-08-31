import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IconCopy, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  getDocumentTemplate,
  publishTemplate,
  unpublishTemplate,
  type TemplateListing,
} from "@/api/templates";
import { isAuthExpiredError } from "@/api/auth";

/**
 * The template half of the Share dialog (docs/design/template-gallery.md).
 *
 * Publishing is manager-gated for the same reason an editor link is: it hands
 * the document's content to an audience workspace membership no longer bounds.
 * `canManage` is therefore the *same* predicate the dialog already resolved for
 * editor links (`permissions.canCreateEditorLink`), not a second one — the
 * backend re-checks it either way.
 */
export function TemplateShareSection({
  documentId,
  canManage,
  ready,
}: {
  documentId: string;
  canManage: boolean;
  /** The parent has finished resolving permissions. */
  ready: boolean;
}) {
  const [listing, setListing] = useState<TemplateListing | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setListing(null);
    let cancelled = false;
    getDocumentTemplate(documentId)
      .then((res) => {
        if (!cancelled) setListing(res);
      })
      .catch((error) => {
        if (cancelled || isAuthExpiredError(error)) return;
        toast.error(
          error instanceof Error ? error.message : "Failed to load template",
        );
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const templateUrl = listing
    ? `${window.location.origin}/t/${listing.id}`
    : null;

  const handlePublish = async () => {
    setBusy(true);
    try {
      const published = await publishTemplate(documentId);
      setListing(published);
      await navigator.clipboard.writeText(
        `${window.location.origin}/t/${published.id}`,
      );
      toast.success("Template link created and copied to clipboard");
    } catch (error) {
      if (isAuthExpiredError(error)) return;
      toast.error(
        error instanceof Error ? error.message : "Failed to publish template",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!templateUrl) return;
    await navigator.clipboard.writeText(templateUrl);
    toast.success("Template link copied to clipboard");
  };

  const handleUnpublish = async () => {
    if (!listing) return;
    setBusy(true);
    try {
      await unpublishTemplate(listing.id);
      setListing(null);
      toast.success("Template unpublished");
    } catch (error) {
      if (isAuthExpiredError(error)) return;
      toast.error(
        error instanceof Error ? error.message : "Failed to unpublish template",
      );
    } finally {
      setBusy(false);
    }
  };

  // Nothing to say to someone who can neither publish nor see a listing.
  if (loaded && !listing && ready && !canManage) return null;

  return (
    <>
      <Separator />
      <div className="grid gap-2">
        <Label>Template</Label>
        {listing ? (
          <>
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{listing.title}</span>
                <span className="text-muted-foreground text-xs">
                  {listing.useCount === 1
                    ? "used once"
                    : `used ${listing.useCount} times`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Copy template link"
                  onClick={handleCopy}
                >
                  <IconCopy className="h-3.5 w-3.5" />
                </Button>
                {listing.canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive h-7 w-7"
                    aria-label="Unpublish template"
                    disabled={busy}
                    onClick={handleUnpublish}
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              Anyone with this link can preview the document and start their own
              copy. Your document is never changed.
            </p>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={busy || !loaded || !ready || !canManage}
              onClick={handlePublish}
            >
              {busy ? "Publishing..." : "Publish as template"}
            </Button>
            <p className="text-muted-foreground text-xs">
              {ready && !canManage
                ? "Only the document owner or a workspace owner can publish a template."
                : "Creates a link others can open to start their own copy of this document."}
            </p>
          </>
        )}
      </div>
    </>
  );
}
