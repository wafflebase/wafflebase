import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IconCamera, IconCopy, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getDocumentTemplate,
  publishTemplate,
  submitTemplateForReview,
  unpublishTemplate,
  updateTemplate,
  TEMPLATE_CATEGORIES,
  type TemplateListing,
  type TemplateVisibility,
} from "@/api/templates";
import { isAuthExpiredError } from "@/api/auth";
import { imageUrl, postSharedImage } from "@/api/images";
import { captureThumbnail, hasThumbnailSource } from "@/lib/thumbnail-capture";

/** `Select` has no empty-string value, so "no category" needs a sentinel. */
const NO_CATEGORY = "__none__";

/**
 * Take the open editor's picture and upload it, answering the image id to
 * store on the listing — or `undefined`.
 *
 * **Never throws.** A thumbnail is decoration on a card: a document type with
 * no renderer, a canvas tainted by a remote image, a failed upload — none of
 * those are reasons to fail the publish this rides along with, and none of
 * them are worth a toast the publisher can do nothing about. The card falls
 * back to its document-type icon, exactly as it did before thumbnails existed.
 *
 * Uploaded through `postSharedImage`, **not** the workspace-scoped route the
 * in-document image pickers use. A template card has to render for a
 * logged-out visitor who holds no membership and no share token, and only an
 * id at the bucket root is readable by `GET /images/:id`. Storing a
 * workspace-scoped id here would put a key on the listing that no route the
 * card can call is able to serve.
 */
async function captureThumbnailId(
  documentId: string,
): Promise<string | undefined> {
  try {
    const blob = await captureThumbnail(documentId);
    if (!blob) return undefined;
    // Named for what it actually is: `encodeThumbnail` falls back to PNG where
    // WebP cannot be encoded, and the extension the server stores comes from
    // the bytes' own MIME type either way.
    const ext = blob.type === "image/png" ? "png" : "webp";
    const { id } = await postSharedImage(blob, `thumbnail.${ext}`);
    return id;
  } catch (error) {
    // An expired session is not a thumbnail failure. Swallowing it here would
    // let the caller carry on to a success toast while `fetchWithAuth` is
    // already redirecting to login; every other handler in this file routes it
    // through `isAuthExpiredError`, and so must this one.
    if (isAuthExpiredError(error)) throw error;
    return undefined;
  }
}

/**
 * Capture a picture of `listing`'s document and attach it, best-effort.
 *
 * Separate from publishing so the upload only ever happens on a path that
 * already succeeded. A listing with no thumbnail is an ordinary state — the
 * card falls back to its document-type icon — so nothing here is worth a toast
 * the user cannot act on.
 */
async function attachThumbnail(
  listing: TemplateListing,
  onSaved: (listing: TemplateListing) => void,
): Promise<void> {
  const thumbnailId = await captureThumbnailId(listing.documentId);
  if (!thumbnailId) return;
  try {
    onSaved(await updateTemplate(listing.id, { thumbnailId }));
  } catch (error) {
    // As above: an expired session has to reach the caller's handler.
    if (isAuthExpiredError(error)) throw error;
    // Otherwise the listing exists and is usable; it just has no picture yet,
    // and "Update preview" can try again.
  }
}

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
  /**
   * Chosen *before* publishing, not after.
   *
   * The audience is the whole decision a publisher is making, and defaulting
   * it to `unlisted` and hiding the control until after the listing exists
   * meant the workspace gallery stayed empty unless someone found a second
   * dropdown and pressed Save again. Defaults to `workspace`, which is what
   * "publish" means to most people; the link works either way.
   */
  const [publishVisibility, setPublishVisibility] =
    useState<TemplateVisibility>("workspace");
  /**
   * Also chosen before publishing, and for a blunter reason than visibility:
   * until this field existed there was no way to set a description at all.
   * The column, the DTO and the frontend API type all carried one, the gallery
   * card and `/t/:id` both render it, and no control anywhere sent it — so
   * every listing ever published through the product had `description: null`.
   *
   * A plain `Input`, not a textarea: the card clamps to two lines, so a taller
   * control would only invite text nobody sees.
   */
  const [publishDescription, setPublishDescription] = useState("");

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

  /**
   * Clipboard failures are reported separately from the mutation that preceded
   * them. A denied clipboard permission after a successful publish would
   * otherwise surface as "Failed to publish template" while the listing is
   * already live — telling the user the opposite of what happened.
   */
  const copyToClipboard = async (url: string, ok: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(ok);
    } catch {
      toast.error("Could not copy the link. Copy it from the address bar.");
    }
  };

  const handlePublish = async () => {
    setBusy(true);
    try {
      // Publish FIRST, then attach the picture. Capturing first would upload a
      // permanently public snapshot of the document — `GET /images/:id` is
      // unauthenticated and immutably cached — before learning whether the
      // publish is even allowed. A 403 from the manager gate, or the 400 that
      // refuses a document connected to external data, would then leave a
      // picture of content the server just declined to share.
      const published = await publishTemplate(documentId, {
        visibility: publishVisibility,
        // Omitted rather than sent empty, so publishing without typing one
        // leaves `description` null instead of storing a blank string that
        // every reader then has to treat as absent.
        ...(publishDescription.trim()
          ? { description: publishDescription.trim() }
          : {}),
      });
      setListing(published);
      await attachThumbnail(published, setListing);
      await copyToClipboard(
        `${window.location.origin}/t/${published.id}`,
        "Template link created and copied to clipboard",
      );
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
    await copyToClipboard(templateUrl, "Template link copied to clipboard");
  };

  const handleSubmitForReview = async () => {
    if (!listing) return;
    setBusy(true);
    try {
      setListing(await submitTemplateForReview(listing.id));
      toast.success("Submitted to the public gallery for review");
    } catch (error) {
      if (isAuthExpiredError(error)) return;
      // Every refusal here is something the publisher can act on — the tier is
      // not open yet, the deployment has not enabled the Yorkie auth webhook,
      // the listing is already under review — so the server's own sentence is
      // more useful than a generic one.
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to submit this template",
      );
    } finally {
      setBusy(false);
    }
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
                {/* A removed listing cannot be unpublished: deleting the row
                    would let the next publish mint a fresh anonymous link to
                    the content a reviewer took down. The button is hidden
                    rather than left to 400, since there is nothing the
                    publisher can do about it. */}
                {listing.canManage && listing.status !== "removed" && (
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
            {/* The decision, where the publisher will look for it. The
                notification carries the same note but is best-effort, and is
                suppressed outright when the reviewer *is* the publisher — so
                this listing is the only durable copy of "why". */}
            {listing.review && listing.status !== "listed" && (
              <div className="bg-muted/50 rounded-md border px-3 py-2 text-xs">
                <p className="font-medium">
                  {listing.status === "pending"
                    ? "Submitted to the public gallery — awaiting review"
                    : listing.status === "rejected"
                      ? "Not accepted into the public gallery"
                      : "Removed from the gallery by a reviewer"}
                </p>
                {listing.review.note && (
                  <p className="text-muted-foreground mt-1">
                    {listing.review.note}
                  </p>
                )}
              </div>
            )}
            {/* Asking for the public gallery. Offered only to a manager of a
                listing that is neither public nor mid-review, and it states
                what publishing publicly costs the *person* rather than the
                document: their username and avatar go with it. */}
            {listing.canManage &&
              listing.visibility !== "public" &&
              // `rejected` too, not just `listed`: the server clears the stale
              // decision and takes the submission again, and nothing else
              // gives a rejected publisher a way back — the edit-triggered
              // re-review only fires for listings that are already public.
              (listing.status === "listed" ||
                listing.status === "rejected") && (
                <div className="rounded-md border p-3">
                  <p className="text-xs font-medium">Public gallery</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Submitting asks a reviewer to list this template publicly.
                    Your username and profile picture appear on the card, and
                    you grant anyone permission to copy and modify the content.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={busy}
                    onClick={handleSubmitForReview}
                  >
                    {listing.status === "rejected"
                      ? "Submit again"
                      : "Submit for review"}
                  </Button>
                </div>
              )}
            {/* Same gate as the unpublish button above. Editing a listing is
                manager-only server-side, so showing the controls to a plain
                member offers an action whose Save can only ever 403. A removed
                listing refuses edits too, for the same reason it refuses an
                unpublish. */}
            {listing.canManage && listing.status !== "removed" && (
              <TemplateMetaEditor
                listing={listing}
                documentId={documentId}
                onSaved={setListing}
              />
            )}
            <p className="text-muted-foreground text-xs">
              {listing.visibility === "workspace"
                ? "Listed in this workspace's Templates tab, and usable by anyone with this link. Your document is never changed."
                : "Anyone with this link can preview the document and start their own copy. Your document is never changed."}
            </p>
          </>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="template-publish-description" className="text-xs">
                Description
              </Label>
              <Input
                id="template-publish-description"
                value={publishDescription}
                onChange={(e) => setPublishDescription(e.target.value)}
                placeholder="What is this template for?"
                disabled={!canManage}
              />
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={publishVisibility}
                onValueChange={(v) =>
                  setPublishVisibility(v as TemplateVisibility)
                }
                disabled={!canManage}
              >
                <SelectTrigger
                  className="flex-1"
                  aria-label="Template visibility"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workspace">
                    Listed in this workspace
                  </SelectItem>
                  <SelectItem value="unlisted">Anyone with the link</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={busy || !loaded || !ready || !canManage}
                onClick={handlePublish}
              >
                {busy ? "Publishing..." : "Publish as template"}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {ready && !canManage
                ? "Only the document owner or a workspace owner can publish a template."
                : publishVisibility === "workspace"
                  ? "Appears in this workspace's Templates tab, and anyone with the link can use it too."
                  : "Only people you send the link to can find it."}
            </p>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Visibility, category and tags for a published listing.
 *
 * Kept as a separate save rather than folded into the publish button: this is
 * what a listing looks like *after* it exists, and publishing is deliberately
 * a one-click action. Only the fields the user actually changed are sent, so
 * `update` leaves everything else alone.
 */
function TemplateMetaEditor({
  listing,
  documentId,
  onSaved,
}: {
  listing: TemplateListing;
  documentId: string;
  onSaved: (listing: TemplateListing) => void;
}) {
  const [visibility, setVisibility] = useState<TemplateVisibility>(
    listing.visibility,
  );
  const [category, setCategory] = useState(listing.category ?? NO_CATEGORY);
  const [tags, setTags] = useState(listing.tags.join(", "));
  const [description, setDescription] = useState(listing.description ?? "");
  const [saving, setSaving] = useState(false);
  const [capturing, setCapturing] = useState(false);

  /**
   * A thumbnail is a snapshot, not a live render — it goes stale as the
   * document changes, and the alternative is rendering a document per card on
   * every gallery paint. So refreshing it is an explicit act, offered only
   * when an editor is actually mounted to take the picture.
   */
  const handleCaptureThumbnail = async () => {
    setCapturing(true);
    try {
      const thumbnailId = await captureThumbnailId(documentId);
      if (!thumbnailId) {
        toast.error("Could not capture a preview of this document");
        return;
      }
      onSaved(await updateTemplate(listing.id, { thumbnailId }));
      toast.success("Template preview updated");
    } catch (error) {
      if (isAuthExpiredError(error)) return;
      toast.error(
        error instanceof Error ? error.message : "Failed to update the preview",
      );
    } finally {
      setCapturing(false);
    }
  };

  const dirty =
    visibility !== listing.visibility ||
    (category === NO_CATEGORY ? null : category) !== listing.category ||
    tags !== listing.tags.join(", ") ||
    description.trim() !== (listing.description ?? "");

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await updateTemplate(listing.id, {
        visibility,
        // Explicit null clears it; undefined would mean "leave alone". Same
        // reason the description below is nulled rather than sent empty:
        // clearing the field has to actually clear the column.
        description: description.trim() || null,
        category: category === NO_CATEGORY ? null : category,
        // Split on commas and let the backend normalize — it is the enforcing
        // copy of the rule (trim / lowercase / de-duplicate / cap at 10).
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onSaved(saved);
      toast.success("Template updated");
    } catch (error) {
      if (isAuthExpiredError(error)) return;
      toast.error(
        error instanceof Error ? error.message : "Failed to update template",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <div className="bg-muted h-12 w-20 shrink-0 overflow-hidden rounded border">
          {listing.thumbnailId ? (
            <img
              src={imageUrl(listing.thumbnailId)}
              alt=""
              // `contain` for the same reason the gallery card uses it: this
              // chip exists to show what was actually captured, and a crop
              // would hide the part the publisher most wants to check.
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="text-muted-foreground flex h-full w-full items-center justify-center text-[10px]">
              No preview
            </div>
          )}
        </div>
        {hasThumbnailSource(documentId) && (
          <Button
            variant="outline"
            size="sm"
            disabled={capturing}
            onClick={handleCaptureThumbnail}
          >
            <IconCamera className="mr-1 h-3.5 w-3.5" />
            {capturing ? "Capturing..." : "Update preview"}
          </Button>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="template-description" className="text-xs">
          Description
        </Label>
        <Input
          id="template-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this template for?"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="template-visibility" className="text-xs">
            Visibility
          </Label>
          <Select
            value={visibility}
            onValueChange={(v) => setVisibility(v as TemplateVisibility)}
          >
            <SelectTrigger id="template-visibility" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unlisted">Anyone with the link</SelectItem>
              <SelectItem value="workspace">This workspace</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="template-category" className="text-xs">
            Category
          </Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="template-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CATEGORY}>None</SelectItem>
              {TEMPLATE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="template-tags" className="text-xs">
          Tags
        </Label>
        <Input
          id="template-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="budget, quarterly"
        />
      </div>
      {dirty && (
        <div className="flex justify-end">
          <Button size="sm" disabled={saving} onClick={handleSave}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
