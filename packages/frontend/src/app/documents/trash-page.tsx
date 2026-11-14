import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IconRestore, IconTrash, IconTrashX } from "@tabler/icons-react";

import {
  deleteDocumentForever,
  deleteDocumentsForever,
  fetchTrash,
  restoreDocument,
  type TrashedDocument,
} from "@/api/documents";
import { isAuthExpiredError } from "@/api/auth";
import { userFacingError } from "@/api/http-error";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { LoadErrorState } from "@/components/load-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DateCell } from "./date-cell";
import { TYPE_META } from "./document-type-meta";

/** Why a row's actions are disabled, shown on hover and focus. */
const CANNOT_MANAGE =
  "Only the document's owner or a workspace owner can restore or delete it";

/** What "Delete forever" destroys, named so the confirm is not a formality. */
const LOSS =
  "Its content, comments, version history and share links are deleted. This can't be undone.";

/**
 * A row action that explains itself when the viewer may not use it. A
 * disabled button receives no pointer or focus events, so the tooltip hangs
 * off a focusable wrapper instead.
 */
function GatedAction({
  allowed,
  children,
}: {
  allowed: boolean;
  children: ReactNode;
}) {
  if (allowed) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="focus-ring inline-flex rounded-md">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{CANNOT_MANAGE}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The workspace's Trash: documents moved there from the list, each with
 * Restore and Delete forever. Nothing here is purged on a schedule, so the
 * page never says it will be.
 */
export default function TrashPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  // The document (or, for "Empty trash", every manageable one) awaiting the
  // delete-forever confirm.
  const [confirming, setConfirming] = useState<
    { kind: "one"; doc: TrashedDocument } | { kind: "all" } | null
  >(null);

  const {
    data: trash = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<TrashedDocument[]>({
    queryKey: ["workspaces", workspaceId, "trash"],
    queryFn: () => fetchTrash(workspaceId!),
    enabled: !!workspaceId,
  });

  // Everything that lists documents hangs off these two prefixes — the
  // workspace lists, their folders and this Trash under ["workspaces"], the
  // all-workspaces list under ["documents"] — so a restore or a purge shows
  // up wherever the user goes next.
  const invalidateLists = () => {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  };

  const restoreMutation = useMutation({
    mutationFn: (doc: TrashedDocument) => restoreDocument(String(doc.id)),
    onSuccess: (_res, doc) => toast.success(`Restored “${doc.title}”`),
    onError: (err) =>
      toast.error(userFacingError(err, "Couldn't restore the document. Try again.")),
    onSettled: invalidateLists,
  });

  const deleteForeverMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 1) await deleteDocumentForever(ids[0]);
      else await deleteDocumentsForever(ids);
    },
    onSuccess: (_res, ids) =>
      toast.success(
        ids.length === 1
          ? "Document deleted forever"
          : `${ids.length} documents deleted forever`,
      ),
    onError: (err) =>
      toast.error(userFacingError(err, "Couldn't delete forever. Try again.")),
    onSettled: () => {
      setConfirming(null);
      invalidateLists();
    },
  });

  const manageable = trash.filter((d) => d.canManage);
  const busy = restoreMutation.isPending || deleteForeverMutation.isPending;

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-9 w-40" />
        <div className="rounded-md border p-4 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (isError) {
    if (isAuthExpiredError(error)) return null;
    return (
      <LoadErrorState
        title="Couldn't load the Trash."
        error={error}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
        noAccessMessage="This workspace doesn't exist, or you no longer have access to it."
      />
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="flex flex-wrap items-center gap-2 py-4">
        <p className="text-sm text-muted-foreground">
          Documents here can be restored to where they were, or deleted forever.
        </p>
        {manageable.length > 0 && (
          <Button
            variant="outline"
            className="ml-auto text-destructive"
            disabled={busy}
            onClick={() => setConfirming({ kind: "all" })}
          >
            <IconTrashX className="h-4 w-4" />
            Empty trash
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-full">Title</TableHead>
              <TableHead className="hidden w-32 text-right sm:table-cell">
                Deleted
              </TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trash.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="h-48">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <IconTrash className="h-10 w-10 stroke-1" />
                    <p className="text-sm font-medium">Trash is empty</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              trash.map((doc) => {
                const { Icon, color } = TYPE_META[doc.type];
                const allowed = doc.canManage === true;
                return (
                  <TableRow key={doc.id}>
                    <TableCell className="max-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                        <span className="truncate" title={doc.title}>
                          {doc.title}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <DateCell value={doc.deletedAt} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <GatedAction allowed={allowed}>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!allowed || busy}
                            aria-label={`Restore ${doc.title}`}
                            onClick={() => restoreMutation.mutate(doc)}
                          >
                            <IconRestore className="h-4 w-4" />
                            <span className="hidden sm:inline">Restore</span>
                          </Button>
                        </GatedAction>
                        <GatedAction allowed={allowed}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={!allowed || busy}
                            aria-label={`Delete ${doc.title} forever`}
                            onClick={() => setConfirming({ kind: "one", doc })}
                          >
                            <IconTrashX className="h-4 w-4" />
                            <span className="hidden sm:inline">
                              Delete forever
                            </span>
                          </Button>
                        </GatedAction>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !deleteForeverMutation.isPending) setConfirming(null);
        }}
      >
        {/* Radix puts initial focus on Cancel, so Enter on open is safe. */}
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.kind === "one"
                ? `Delete “${confirming.doc.title}” forever?`
                : "Empty trash?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.kind === "one"
                ? LOSS
                : `This deletes ${manageable.length === 1 ? "1 document" : `${manageable.length} documents`} forever, with their content, comments, version history and share links. This can't be undone.${
                    manageable.length < trash.length
                      ? " Documents you can't manage stay in the Trash."
                      : ""
                  }`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteForeverMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleteForeverMutation.isPending}
              onClick={(e) => {
                // Keep the dialog up until the request settles, so a failure
                // is reported against the thing the user just confirmed.
                e.preventDefault();
                if (!confirming) return;
                deleteForeverMutation.mutate(
                  confirming.kind === "one"
                    ? [String(confirming.doc.id)]
                    : manageable.map((d) => String(d.id)),
                );
              }}
            >
              {confirming?.kind === "one" ? "Delete forever" : "Empty trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
