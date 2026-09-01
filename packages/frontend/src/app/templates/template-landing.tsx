import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getTemplate, createFromTemplate } from "@/api/templates";
import { fetchWorkspaces } from "@/api/workspaces";
import { fetchMeOptional, isAuthExpiredError } from "@/api/auth";
import { Loader } from "@/components/loader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getDocumentPath } from "@/app/documents/document-list-utils";
import type { DocumentType } from "@/types/documents";

/**
 * A listing stores a bare image *id*, not a URL, so it can only ever point at
 * this deployment's image bucket. `GET /images/:id` is unauthenticated and
 * immutably cached, which is what lets a logged-out visitor see the card.
 */
function thumbnailUrl(id: string): string {
  return `${import.meta.env.VITE_BACKEND_API_URL}/images/${encodeURIComponent(id)}`;
}

/**
 * `/t/:id` — the template landing page (docs/design/template-gallery.md).
 *
 * Renders for a logged-out visitor, which is the point: a template link is
 * handed to people who may not have an account yet. Using one needs a
 * destination workspace, so it is the *Use* action — not the page — that
 * requires signing in, the same split Canva and CapCut both make.
 */
export function TemplateLanding() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const listing = useQuery({
    queryKey: ["template", id],
    queryFn: () => getTemplate(id!),
    enabled: !!id,
    retry: false,
  });

  const me = useQuery({
    queryKey: ["me-optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });
  const signedIn = !!me.data;

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
    enabled: signedIn,
  });

  useEffect(() => {
    if (!workspaceId && workspaces.data?.length) {
      setWorkspaceId(workspaces.data[0].id);
    }
  }, [workspaces.data, workspaceId]);

  const previewUrl = useMemo(
    () =>
      listing.data?.previewToken
        ? `/shared/${listing.data.previewToken}`
        : null,
    [listing.data?.previewToken],
  );

  const handleUse = async () => {
    if (!id) return;
    if (!signedIn) {
      // Straight to `/login`, not `/login?redirect=…`: the GitHub callback
      // returns the browser to FRONTEND_URL, so a return path would have to be
      // carried through the OAuth state and validated server-side. Tracked as
      // a follow-up; until then the copy below tells the visitor to reopen the
      // link.
      navigate("/login");
      return;
    }
    if (!workspaceId) {
      toast.error("Choose a workspace first");
      return;
    }
    setCreating(true);
    try {
      const doc = await createFromTemplate(id, workspaceId);
      toast.success("Document created from template");
      navigate(getDocumentPath({ id: doc.id, type: doc.type as DocumentType }));
    } catch (error) {
      // `fetchWithAuth` redirects to login and throws when the session has
      // expired; a failure toast on top of that redirect is stale noise.
      if (isAuthExpiredError(error)) return;
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create a document from this template",
      );
    } finally {
      setCreating(false);
    }
  };

  if (listing.isLoading) return <Loader />;

  if (listing.isError || !listing.data) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-24 text-center">
        <h1 className="text-xl font-semibold">Template not found</h1>
        <p className="text-muted-foreground text-sm">
          This template link is invalid, or it has been unpublished.
        </p>
      </div>
    );
  }

  const t = listing.data;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">
        Template
      </p>
      <h1 className="mt-1 text-2xl font-semibold">{t.title}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {t.author ? `Shared by ${t.author.username} · ` : ""}
        {t.documentType}
        {t.useCount > 0 &&
          ` · used ${t.useCount} ${t.useCount === 1 ? "time" : "times"}`}
      </p>

      {t.description && <p className="mt-4 text-sm">{t.description}</p>}

      {t.thumbnailId && (
        <img
          src={thumbnailUrl(t.thumbnailId)}
          alt=""
          className="mt-6 w-full max-w-full rounded-md border"
        />
      )}

      <div className="mt-8 flex flex-wrap items-end gap-3">
        {signedIn && (
          <div className="grid gap-2">
            <Label htmlFor="template-workspace">Workspace</Label>
            <Select value={workspaceId} onValueChange={setWorkspaceId}>
              <SelectTrigger id="template-workspace" className="w-56">
                <SelectValue placeholder="Choose a workspace" />
              </SelectTrigger>
              <SelectContent>
                {(workspaces.data ?? []).map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button onClick={handleUse} disabled={creating}>
          {creating
            ? "Creating..."
            : signedIn
              ? "Use this template"
              : "Sign in to use this template"}
        </Button>
        {previewUrl && (
          <Button variant="outline" asChild>
            <a href={previewUrl} target="_blank" rel="noreferrer">
              Preview
            </a>
          </Button>
        )}
      </div>

      <p className="text-muted-foreground mt-4 text-xs">
        {signedIn
          ? "You get your own copy to edit. The original is never changed."
          : "Sign in, then open this link again to start your own copy. The original is never changed."}
      </p>
    </div>
  );
}

export default TemplateLanding;
