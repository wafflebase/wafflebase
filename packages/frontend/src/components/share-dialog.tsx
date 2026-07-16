import { useState, useEffect } from "react";
import { toast } from "sonner";
import { IconShare, IconCopy, IconTrash } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  createShareLink,
  getShareLinks,
  deleteShareLink,
  ShareLinkListItem,
  ShareLinkPermissions,
} from "@/api/share-links";
import { isAuthExpiredError } from "@/api/auth";

const DEFAULT_PERMISSIONS: ShareLinkPermissions = {
  canCreateEditorLink: false,
};

const EXPIRATION_OPTIONS = [
  { value: "none", label: "No limit" },
  { value: "1h", label: "1 hour" },
  { value: "8h", label: "8 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

function formatExpiration(expiresAt: string | null): string {
  if (!expiresAt) return "No expiration";
  const expires = new Date(expiresAt);
  const now = new Date();
  if (expires < now) return "Expired";
  const diffMs = expires.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return `Expires in ${diffDays}d`;
  if (diffHours > 0) return `Expires in ${diffHours}h`;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  return `Expires in ${diffMinutes}m`;
}

/**
 * Renders the ShareDialog component.
 */
export function ShareDialog({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("viewer");
  const [expiration, setExpiration] = useState("none");
  const [links, setLinks] = useState<ShareLinkListItem[]>([]);
  const [permissions, setPermissions] =
    useState<ShareLinkPermissions>(DEFAULT_PERMISSIONS);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  // Refetch links + capabilities whenever the dialog opens or the document
  // changes, resetting first so stale permissions from a previous document
  // never leak into the gating below.
  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setLinks([]);
    setPermissions(DEFAULT_PERMISSIONS);
    let cancelled = false;
    getShareLinks(documentId)
      .then((res) => {
        if (cancelled) return;
        setLinks(res.links);
        setPermissions(res.permissions);
      })
      .catch((error) => {
        if (cancelled || isAuthExpiredError(error)) return;
        // Surface the failure and still unblock the form: permissions stay at
        // their viewer-only default and the backend remains the real gate, so
        // the user can retry rather than facing a permanently disabled button.
        toast.error(
          error instanceof Error ? error.message : "Failed to load share links",
        );
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, documentId]);

  // A member who cannot create editor links must fall back to a viewer link.
  useEffect(() => {
    if (loaded && !permissions.canCreateEditorLink && role === "editor") {
      setRole("viewer");
    }
  }, [loaded, permissions.canCreateEditorLink, role]);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const link = await createShareLink(
        documentId,
        role,
        expiration === "none" ? null : expiration,
      );
      // The creator can always revoke a link they just made.
      setLinks((prev) => [{ ...link, canDelete: true }, ...prev]);
      const url = `${window.location.origin}/shared/${link.token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link created and copied to clipboard");
    } catch (error) {
      if (isAuthExpiredError(error)) return;
      toast.error(
        error instanceof Error ? error.message : "Failed to create share link",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (token: string) => {
    const url = `${window.location.origin}/shared/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteShareLink(id);
      setLinks((prev) => prev.filter((l) => l.id !== id));
      toast.success("Share link revoked");
    } catch (error) {
      if (isAuthExpiredError(error)) return;
      toast.error("Failed to revoke share link");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 cursor-pointer p-0"
              aria-label="Share"
            >
              <IconShare className="h-4 w-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Share</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Document</DialogTitle>
          <DialogDescription>
            Create a link to share this document with others.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label htmlFor="share-role">Permission</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="share-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem
                    value="editor"
                    disabled={!loaded || !permissions.canCreateEditorLink}
                  >
                    Editor
                  </SelectItem>
                </SelectContent>
              </Select>
              {loaded && !permissions.canCreateEditorLink && (
                <p className="text-muted-foreground text-xs">
                  Only the document owner or a workspace owner can create editor
                  links.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="share-expiration">Expiration</Label>
              <Select value={expiration} onValueChange={setExpiration}>
                <SelectTrigger id="share-expiration" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {links.length > 0 && (
            <>
              <Separator />
              <div className="grid gap-2">
                <Label>Active links</Label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {links.map((link) => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="capitalize font-medium">
                          {link.role}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatExpiration(link.expiresAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Copy link"
                          onClick={() => handleCopy(link.token)}
                        >
                          <IconCopy className="h-3.5 w-3.5" />
                        </Button>
                        {link.canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            aria-label="Revoke link"
                            onClick={() => handleDelete(link.id)}
                          >
                            <IconTrash className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end">
          <Button onClick={handleCreate} disabled={loading || !loaded}>
            {loading ? "Creating..." : "Create Link"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
