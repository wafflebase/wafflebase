import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getTemplate,
  createFromTemplate,
  reportTemplate,
  REPORT_REASONS,
  type ReportReason,
} from "@/api/templates";
import { imageUrl } from "@/api/images";
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
import { typeMeta } from "@/app/documents/document-type-meta";
import { MarketingPage } from "@/app/home/marketing-page";
import { WbButton } from "@/app/home/primitives/wb-button";
import { SharedDocumentByToken } from "@/app/shared/shared-document";
import type { DocumentType } from "@/types/documents";

/**
 * `/t/:id` — the template landing page (docs/design/template-gallery.md).
 *
 * Renders for a logged-out visitor, which is the point: a template link is
 * handed to people who may not have an account yet. Using one needs a
 * destination workspace, so it is the *Use* action — not the page — that
 * requires signing in, the same split Canva and CapCut both make.
 */
/**
 * Come back to this template after signing in. The path is a *request*: the
 * backend stores it in its own cookie and re-validates it in the OAuth
 * callback, refusing anything that is not a same-origin path
 * (packages/backend/src/auth/login-return-path.ts).
 */
function signInPath(id: string | undefined) {
  return id
    ? `/login?returnTo=${encodeURIComponent(`/t/${id}`)}`
    : "/login";
}

/** Reader-facing names for the closed reason list. */
const REPORT_LABELS: Record<ReportReason, string> = {
  copyright: "Copyright violation",
  inappropriate: "Inappropriate content",
  broken: "Broken or unusable",
  spam: "Spam",
  other: "Something else",
};

export function TemplateLanding() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reporting, setReporting] = useState(false);
  const [thumbnailBroken, setThumbnailBroken] = useState(false);

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


  const handleUse = async () => {
    if (!id) return;
    if (!signedIn) {
      navigate(signInPath(id));
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

  // The chrome comes first even while loading and on the failure path: this is
  // the page a stranger is handed, and a bare centered sentence with no way
  // back to anything is the worst possible landing.
  if (listing.isLoading) {
    return (
      <MarketingPage signInTo={signInPath(id)}>
        <Loader />
      </MarketingPage>
    );
  }

  if (listing.isError || !listing.data) {
    return (
      <MarketingPage signInTo={signInPath(id)}>
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
          <h1 className="m-0 font-display text-[28px] font-semibold tracking-[-0.01em] text-[color:var(--wb-ink)]">
            Template not found
          </h1>
          <p className="m-0 text-[15px] text-[color:var(--wb-sub)]">
            This template link is invalid, or it has been unpublished.
          </p>
          <WbButton asChild variant="ghost" className="mt-2">
            <Link to="/templates">Browse the gallery</Link>
          </WbButton>
        </div>
      </MarketingPage>
    );
  }

  const t = listing.data;
  const { Icon, color, label } = typeMeta(t.documentType);

  // The real read-only viewer, mounted on the listing's own preview token —
  // not a second tab and not a screenshot. Full-screen because the viewers
  // render their own chrome and expect the viewport.
  if (previewing && t.previewToken) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <div className="absolute top-3 right-3 z-10">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPreviewing(false)}
          >
            Close preview
          </Button>
        </div>
        <SharedDocumentByToken token={t.previewToken} />
      </div>
    );
  }

  // Same paper surface the gallery cards use, so a card and the page it opens
  // read as the same object at two sizes.
  const field =
    "border-[color:var(--wb-rule)] bg-[color:var(--wb-paper)] text-[color:var(--wb-ink)]";

  return (
    <MarketingPage signInTo={signInPath(id)}>
      <div className="mx-auto max-w-[1200px] px-6 py-14 md:px-8 md:py-20">
        <div className="grid gap-10 md:grid-cols-[1.15fr_1fr] md:gap-14">
          {/* The picture leads on desktop but follows on mobile: on a phone the
              title and the button are what the visitor came for, and a
              full-width preview above them pushes both below the fold. */}
          <div
            className="order-2 overflow-hidden rounded-2xl border border-[color:var(--wb-rule)] md:order-1"
            style={{
              boxShadow:
                "0 1px 0 rgba(42,30,18,0.04), 0 12px 28px -16px rgba(42,30,18,0.18)",
            }}
          >
            <div
              className="flex aspect-[16/10] w-full items-center justify-center"
              style={{
                background:
                  "color-mix(in srgb, var(--wb-butter) 22%, transparent)",
              }}
            >
              {t.thumbnailId && !thumbnailBroken ? (
                <img
                  src={imageUrl(t.thumbnailId)}
                  alt=""
                  // Same fallback as the gallery card: an id outlives the
                  // object it names, and a broken-image box is the worst thing
                  // to show on the one page a stranger lands on.
                  onError={() => setThumbnailBroken(true)}
                  className="h-full w-full object-contain"
                />
              ) : (
                <Icon className={`h-16 w-16 stroke-1 ${color}`} />
              )}
            </div>
          </div>

          <div className="order-1 flex flex-col md:order-2">
            <div className="mb-3 inline-flex items-center gap-2 font-code text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--wb-syrup-deep)]">
              <span className="size-1.5 rounded-full bg-[color:var(--wb-syrup)]" />
              Template
            </div>
            <h1
              className="m-0 font-display text-[clamp(28px,3.5vw,40px)] font-semibold leading-[1.1] tracking-[-0.01em] text-[color:var(--wb-ink)]"
              style={{ fontFeatureSettings: "'ss01' on, 'ss02' on" }}
            >
              {t.title}
            </h1>
            <p className="mt-3 mb-0 font-code text-[12px] tracking-[0.04em] text-[color:var(--wb-sub)]">
              {t.author ? `Shared by ${t.author.username} · ` : ""}
              {label}
              {t.useCount > 0 &&
                ` · used ${t.useCount} ${t.useCount === 1 ? "time" : "times"}`}
            </p>

            {t.description && (
              <p className="mt-5 mb-0 text-[15px] leading-[1.55] text-[color:var(--wb-sub)]">
                {t.description}
              </p>
            )}

            <div className="mt-8 flex flex-wrap items-end gap-3">
              {signedIn && (
                <div className="grid gap-2">
                  <Label
                    htmlFor="template-workspace"
                    className="font-code text-[11.5px] uppercase tracking-[0.1em] text-[color:var(--wb-sub)]"
                  >
                    Workspace
                  </Label>
                  <Select value={workspaceId} onValueChange={setWorkspaceId}>
                    <SelectTrigger
                      id="template-workspace"
                      className={`w-56 ${field}`}
                    >
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
              <WbButton size="lg" onClick={handleUse} disabled={creating}>
                {creating
                  ? "Creating..."
                  : signedIn
                    ? "Use this template"
                    : "Sign in to use this template"}
              </WbButton>
              {t.previewToken && (
                <WbButton
                  variant="ghost"
                  size="lg"
                  onClick={() => setPreviewing(true)}
                >
                  Preview
                </WbButton>
              )}
            </div>

            <p className="mt-4 mb-0 text-[13px] text-[color:var(--wb-sub)]">
              {signedIn
                ? "You get your own copy to edit. The original is never changed."
                : "Sign in and we'll bring you back here. The original is never changed."}
            </p>

            {/* Reporting needs an account, so the affordance only appears for
                one — and it is deliberately quiet: a report is a message to a
                reviewer, not an action on the listing, and nothing about it
                should read like a button that removes something. */}
            {signedIn && !t.canManage && (
              <div className="mt-10 flex flex-wrap items-center gap-2 border-t border-[color:var(--wb-rule)] pt-6">
                <Select value={reportReason} onValueChange={setReportReason}>
                  <SelectTrigger
                    className={`w-52 ${field}`}
                    aria-label="Reason for reporting"
                  >
                    <SelectValue placeholder="Report this template" />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_REASONS.map((reason) => (
                      <SelectItem key={reason} value={reason}>
                        {REPORT_LABELS[reason]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {reportReason && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={reporting}
                    onClick={async () => {
                      if (!id) return;
                      setReporting(true);
                      try {
                        await reportTemplate(id, reportReason as ReportReason);
                        setReportReason("");
                        toast.success("Reported. A reviewer will take a look.");
                      } catch (error) {
                        if (isAuthExpiredError(error)) return;
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Failed to report this template",
                        );
                      } finally {
                        setReporting(false);
                      }
                    }}
                  >
                    {reporting ? "Reporting..." : "Send report"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </MarketingPage>
  );
}

export default TemplateLanding;
