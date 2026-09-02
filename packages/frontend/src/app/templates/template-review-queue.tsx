import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listTemplateReports,
  listTemplatesForReview,
  resolveTemplateReport,
  reviewTemplate,
  type ReviewDecision,
  type TemplateListing,
} from "@/api/templates";
import { imageUrl } from "@/api/images";
import { isAuthExpiredError } from "@/api/auth";
import { HttpError } from "@/api/http-error";
import { Loader } from "@/components/loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SharedDocumentByToken } from "@/app/shared/shared-document";

/**
 * What each decision is called once it is done. A table rather than
 * `` `Template ${decision}d` `` — that reads "Template rejectd" and "Template
 * takedownd", and only works at all for "approve" by accident.
 */
const DECISION_DONE: Record<ReviewDecision, string> = {
  approve: "Template approved",
  reject: "Template rejected",
  takedown: "Template taken down",
};

/**
 * `/admin/templates` — the template review queue
 * (docs/design/template-gallery.md, Phase 3a).
 *
 * A queue, not an admin console: it can see template submissions and nothing
 * else. Who may open it is decided by the backend's
 * `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` allowlist, so this page has no gate of its
 * own — an unauthorized caller gets a `403` from the queue request and the
 * "not a reviewer" state below. Hiding the route from the client would be
 * decoration; the guard is the authority.
 *
 * It exists because the alternative to a screen is reviewing by `curl`, which
 * in practice means not reviewing — and a submission nobody looks at is the
 * failure mode this whole pipeline is built to avoid.
 */
export function TemplateReviewQueue() {
  const queryClient = useQueryClient();
  const [previewing, setPreviewing] = useState<TemplateListing | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const queue = useQuery({
    queryKey: ["template-review-queue"],
    queryFn: listTemplatesForReview,
    retry: false,
  });

  // Reports are a second list rather than a merged one: a submission asks
  // "should this be listed", a report asks "should this stay listed", and a
  // reviewer works them with different questions in mind.
  const reports = useQuery({
    queryKey: ["template-reports"],
    queryFn: listTemplateReports,
    retry: false,
    // Sequenced behind the queue rather than fired alongside it. Both are
    // reviewer-gated, so a parallel fetch means a non-reviewer collects two
    // 403s for one page — and `!queue.isError` would not prevent it, since
    // nothing is an error yet on the first render. The queue is small enough
    // that the extra round trip costs nothing worth the duplicate.
    enabled: queue.isSuccess,
  });

  const closeReport = useMutation({
    mutationFn: ({
      reportId,
      outcome,
    }: {
      reportId: string;
      outcome: "dismissed" | "actioned";
    }) => resolveTemplateReport(reportId, outcome),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["template-reports"] });
    },
    onError: (error: unknown) => {
      if (isAuthExpiredError(error)) return;
      toast.error(
        error instanceof Error ? error.message : "Failed to close this report"
      );
    },
  });

  const decide = useMutation({
    mutationFn: ({
      id,
      decision,
      note,
      contentAt,
    }: {
      id: string;
      decision: ReviewDecision;
      note?: string;
      contentAt?: string | null;
    }) => reviewTemplate(id, decision, note, contentAt),
    onSuccess: (_result, variables) => {
      toast.success(DECISION_DONE[variables.decision]);
      void queryClient.invalidateQueries({
        queryKey: ["template-review-queue"],
      });
      // A takedown closes every open report about the listing, server-side
      // and inside the same transaction — so the list has to be refetched.
      void queryClient.invalidateQueries({ queryKey: ["template-reports"] });
    },
    onError: (error: unknown) => {
      if (isAuthExpiredError(error)) return;
      toast.error(
        error instanceof Error ? error.message : "Failed to record this decision"
      );
    },
  });

  // The real read-only viewer on the submission's own preview token. A
  // reviewer belongs to neither the publisher's workspace nor the document, so
  // this token — returned by the queue endpoint and by nothing else — is the
  // only way they can see what they are deciding.
  if (previewing?.previewToken) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <div className="absolute top-3 right-3 z-10">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPreviewing(null)}
          >
            Close preview
          </Button>
        </div>
        <SharedDocumentByToken token={previewing.previewToken} />
      </div>
    );
  }

  if (queue.isLoading) return <Loader />;

  if (queue.isError) {
    // A 403 is the allowlist; anything else is a failure, and telling a real
    // reviewer they are not one — with no way to retry — is worse than saying
    // nothing.
    const forbidden =
      queue.error instanceof HttpError && queue.error.status === 403;
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
        <h1 className="text-xl font-semibold">
          {forbidden ? "Not a template reviewer" : "Couldn’t load the queue"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {forbidden
            ? "Reviewing the public template gallery is limited to the accounts named in this deployment’s reviewer allowlist."
            : "The review queue could not be loaded. This is usually temporary."}
        </p>
        {!forbidden && (
          <Button size="sm" variant="secondary" onClick={() => queue.refetch()}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  const items = queue.data ?? [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Template review</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Submissions waiting for a decision before they enter the public gallery.
      </p>

      {items.length === 0 ? (
        <p className="text-muted-foreground mt-10 text-sm">
          Nothing is waiting for review.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-4">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row"
            >
              <div className="bg-muted flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded">
                {t.thumbnailId ? (
                  <img
                    src={imageUrl(t.thumbnailId)}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-muted-foreground text-xs uppercase">
                    {t.documentType}
                  </span>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div>
                  <p className="truncate font-medium">{t.title}</p>
                  <p className="text-muted-foreground text-sm">
                    {t.author ? `by ${t.author.username} · ` : ""}
                    {t.documentType}
                    {t.category ? ` · ${t.category}` : ""}
                  </p>
                </div>
                {t.description && (
                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {t.description}
                  </p>
                )}

                <Input
                  value={notes[t.id] ?? ""}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [t.id]: e.target.value }))
                  }
                  placeholder="Reason (sent to the publisher on a rejection)"
                  className="mt-1"
                />

                <div className="mt-1 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!t.previewToken}
                    onClick={() => setPreviewing(t)}
                  >
                    {t.previewToken ? "Preview" : "No preview"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        id: t.id,
                        decision: "approve",
                        note: notes[t.id],
                        // What this row was fetched with. If the document has
                        // moved since, the backend refuses the approval rather
                        // than publishing content nobody read.
                        contentAt: t.review?.contentAt,
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        id: t.id,
                        decision: "reject",
                        note: notes[t.id],
                      })
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        id: t.id,
                        decision: "takedown",
                        note: notes[t.id],
                      })
                    }
                  >
                    Take down
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-12 text-lg font-semibold">Reports</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Listings someone flagged. A report changes nothing on its own — closing
        one is a separate action from deciding the listing.
      </p>
      {(reports.data ?? []).length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">
          Nothing has been reported.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {(reports.data ?? []).map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{r.listing.title}</p>
                <p className="text-muted-foreground text-sm">
                  {r.reason}
                  {r.note ? ` — ${r.note}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!r.listing.previewToken}
                  onClick={() => setPreviewing(r.listing)}
                >
                  {r.listing.previewToken ? "Preview" : "No preview"}
                </Button>
                <Input
                  value={notes[r.id] ?? ""}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                  }
                  placeholder="Your reason (sent to the publisher)"
                  className="w-64"
                  aria-label={`Reason for taking down ${r.listing.title}`}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={decide.isPending || !notes[r.id]?.trim()}
                  onClick={() =>
                    // The reviewer's own words, not the reporter's. The note
                    // reaches the publisher labelled as a decision, and up to
                    // 500 characters of reporter-authored text arriving under
                    // a reviewer's authority is not a thing to pass through.
                    decide.mutate({
                      id: r.listing.id,
                      decision: "takedown",
                      note: notes[r.id],
                    })
                  }
                >
                  Take down
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={closeReport.isPending}
                  onClick={() =>
                    closeReport.mutate({
                      reportId: r.id,
                      outcome: "dismissed",
                    })
                  }
                >
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default TemplateReviewQueue;
