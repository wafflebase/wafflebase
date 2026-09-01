import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IconCopy, IconTrash } from "@tabler/icons-react";
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
  unpublishTemplate,
  updateTemplate,
  TEMPLATE_CATEGORIES,
  type TemplateListing,
  type TemplateVisibility,
} from "@/api/templates";
import { isAuthExpiredError } from "@/api/auth";

/** `Select` has no empty-string value, so "no category" needs a sentinel. */
const NO_CATEGORY = "__none__";

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
      const published = await publishTemplate(documentId, {
        visibility: publishVisibility,
      });
      setListing(published);
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
            {/* Same gate as the unpublish button above. Editing a listing is
                manager-only server-side, so showing the controls to a plain
                member offers an action whose Save can only ever 403. */}
            {listing.canManage && (
              <TemplateMetaEditor listing={listing} onSaved={setListing} />
            )}
            <p className="text-muted-foreground text-xs">
              {listing.visibility === "workspace"
                ? "Listed in this workspace's Templates tab, and usable by anyone with this link. Your document is never changed."
                : "Anyone with this link can preview the document and start their own copy. Your document is never changed."}
            </p>
          </>
        ) : (
          <>
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
  onSaved,
}: {
  listing: TemplateListing;
  onSaved: (listing: TemplateListing) => void;
}) {
  const [visibility, setVisibility] = useState<TemplateVisibility>(
    listing.visibility,
  );
  const [category, setCategory] = useState(listing.category ?? NO_CATEGORY);
  const [tags, setTags] = useState(listing.tags.join(", "));
  const [saving, setSaving] = useState(false);

  const dirty =
    visibility !== listing.visibility ||
    (category === NO_CATEGORY ? null : category) !== listing.category ||
    tags !== listing.tags.join(", ");

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await updateTemplate(listing.id, {
        visibility,
        // Explicit null clears it; undefined would mean "leave alone".
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
