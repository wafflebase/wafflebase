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
  ShareLink,
} from "@/api/share-links";
import { isAuthExpiredError } from "@/api/auth";

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
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      getShareLinks(documentId)
        .then(setLinks)
        .catch(() => {});
    }
  }, [open, documentId]);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const link = await createShareLink(
        documentId,
        role,
        expiration === "none" ? null : expiration,
      );
      setLinks((prev) => [link, ...prev]);
      const url = `${window.location.origin}/shared/${link.token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link created and copied to clipboard");
    } catch (error) {
      if (isAuthExpiredError(error)) return;
      toast.error("Failed to create share link");
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
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <IconShare className="h-4 w-4 mr-1" />
          Share
        </Button>
      </DialogTrigger>
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
                  <SelectItem value="editor">Editor</SelectItem>
                </SelectContent>
              </Select>
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
                          onClick={() => handleCopy(link.token)}
                        >
                          <IconCopy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => handleDelete(link.id)}
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end">
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create Link"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
