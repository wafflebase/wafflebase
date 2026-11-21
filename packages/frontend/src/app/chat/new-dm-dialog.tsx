import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { fetchMe } from "@/api/auth";
import { userFacingError } from "@/api/http-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspaceMembers } from "@/components/comments/use-workspace-members";
import {
  useChannelMembers,
  useInviteToChannel,
  useOpenDm,
} from "@/components/chat/use-chat";
import { MemberPicker } from "./member-picker";

/** Others a DM may include; with the caller that is the server's 8. */
const MAX_DM_OTHERS = 7;

interface NewDmDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: (channelId: string) => void;
}

/**
 * Start a direct message with one to seven people. Picking the same people
 * again lands in the existing conversation — the server deduplicates by
 * member set.
 */
export function NewDmDialog({
  workspaceId,
  open,
  onOpenChange,
  onOpened,
}: NewDmDialogProps) {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const members = useWorkspaceMembers(workspaceId).filter(
    (m) => m.userId !== String(me?.id),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const openDm = useOpenDm(workspaceId);

  const close = (next: boolean) => {
    if (!next) setSelected([]);
    onOpenChange(next);
  };

  const start = () => {
    openDm.mutate(selected.map(Number), {
      onSuccess: (channel) => {
        close(false);
        onOpened(channel.id);
      },
      onError: (err) =>
        toast.error(
          userFacingError(err, "Couldn't start the conversation. Try again."),
        ),
    });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Pick up to {MAX_DM_OTHERS} people from this workspace.
          </DialogDescription>
        </DialogHeader>
        <MemberPicker
          members={members}
          selected={selected}
          onChange={setSelected}
          max={MAX_DM_OTHERS}
          inviteHref={`/w/${workspaceId}/settings`}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            onClick={start}
            disabled={selected.length === 0 || openDm.isPending}
          >
            Start conversation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AddPeopleDialogProps {
  workspaceId: string;
  channelId: string;
  channelName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Invite workspace members into a channel. */
export function AddPeopleDialog({
  workspaceId,
  channelId,
  channelName,
  open,
  onOpenChange,
}: AddPeopleDialogProps) {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const members = useWorkspaceMembers(workspaceId).filter(
    (m) => m.userId !== String(me?.id),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const invite = useInviteToChannel(workspaceId);
  // Those already here stay listed but unpickable ("Already here").
  const { data: channelMembers } = useChannelMembers(
    workspaceId,
    channelId,
    open,
  );
  const inChannel = (channelMembers ?? []).map((m) => String(m.id));

  const close = (next: boolean) => {
    if (!next) setSelected([]);
    onOpenChange(next);
  };

  const add = () => {
    invite.mutate(
      { channelId, userIds: selected.map(Number) },
      {
        onSuccess: () => {
          toast.success(
            selected.length === 1
              ? `Added 1 person to #${channelName}`
              : `Added ${selected.length} people to #${channelName}`,
          );
          close(false);
        },
        onError: (err) =>
          toast.error(
            userFacingError(
              err,
              "Couldn't add people to the channel. Try again.",
            ),
          ),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add people to #{channelName}</DialogTitle>
          <DialogDescription>
            They'll see the channel and its history.
          </DialogDescription>
        </DialogHeader>
        <MemberPicker
          members={members}
          selected={selected}
          onChange={setSelected}
          excluded={inChannel}
          inviteHref={`/w/${workspaceId}/settings`}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            onClick={add}
            disabled={selected.length === 0 || invite.isPending}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
