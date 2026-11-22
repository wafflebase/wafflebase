import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchMemberRemovalImpact,
  type MemberRemovalImpact,
} from "@/api/webhooks";
import { removalConsequences } from "./webhook-copy";

/**
 * Confirms removing a member and says what goes with them. Since chat
 * shipped, removing someone also hard-deletes any private channel only they
 * belonged to, messages included, and turns off the webhooks they created
 * (docs/design/webhooks.md § Removing a member) — neither of which a bare
 * trash-can click told anyone.
 */
export function RemoveMemberDialog({
  workspaceId,
  member,
  isSelf,
  pending,
  onCancel,
  onConfirm,
}: {
  workspaceId: string;
  /** The member being removed; null keeps the dialog closed. */
  member: { userId: number; username: string } | null;
  isSelf: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const {
    data: impact,
    isLoading,
    isError,
  } = useQuery<MemberRemovalImpact>({
    queryKey: ["workspaces", workspaceId, "removal-impact", member?.userId],
    queryFn: () => fetchMemberRemovalImpact(workspaceId, member!.userId),
    enabled: !!member,
    // Fresh each time: the counts move as channels and webhooks change.
    staleTime: 0,
    gcTime: 0,
  });

  const consequences = impact ? removalConsequences(impact, isSelf) : [];

  return (
    <Dialog
      open={!!member}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isSelf ? "Leave workspace" : `Remove ${member?.username ?? ""}`}
          </DialogTitle>
          <DialogDescription>
            {isSelf
              ? "You'll lose access to this workspace and its documents."
              : `${member?.username ?? "They"} will lose access to this workspace and its documents.`}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2" aria-label="Checking what this affects">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            Couldn't check what else this affects. Private channels only{" "}
            {isSelf ? "you" : "they"} belong to may be deleted, and webhooks{" "}
            {isSelf ? "you" : "they"} created turned off.
          </p>
        ) : consequences.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || isLoading}
            onClick={onConfirm}
          >
            {isSelf ? "Leave" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
