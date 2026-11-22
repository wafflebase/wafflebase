import { useState } from "react";
import { IconUserPlus, IconUsers } from "@tabler/icons-react";
import { toast } from "sonner";

import type { ChannelSummary, ChatUserSummary } from "@/api/chat";
import { userFacingError } from "@/api/http-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthorAvatar } from "@/components/comments/components/AuthorAvatar";
import {
  useChannelMembers,
  useRemoveChannelMember,
} from "@/components/chat/use-chat";
import { canRemoveMembers } from "./channel-members";
import { channelMenu } from "./chat-layout";

interface ChannelMembersButtonProps {
  workspaceId: string;
  channelId: string;
  onClick: () => void;
}

/**
 * The channel header's member count. It shares the dialog's query, so
 * opening the dialog shows the list without a second fetch.
 */
export function ChannelMembersButton({
  workspaceId,
  channelId,
  onClick,
}: ChannelMembersButtonProps) {
  const members = useChannelMembers(workspaceId, channelId, true);
  const count = members.data?.length;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="shrink-0 gap-1 px-2 text-muted-foreground tabular-nums pointer-coarse:min-h-11"
      aria-label={count === undefined ? "Members" : `Members: ${count}`}
      onClick={onClick}
    >
      <IconUsers />
      {count}
    </Button>
  );
}

interface ChannelMembersDialogProps {
  workspaceId: string;
  channel: ChannelSummary;
  meId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the Add people dialog; this one closes first. */
  onAddPeople: () => void;
}

/** Who is in a public or private channel, with Add people and Remove. */
export function ChannelMembersDialog({
  workspaceId,
  channel,
  meId,
  open,
  onOpenChange,
  onAddPeople,
}: ChannelMembersDialogProps) {
  const members = useChannelMembers(workspaceId, channel.id, open);
  const remove = useRemoveChannelMember(workspaceId);
  // The row asking "Remove …?" in place, rather than a second modal on top.
  const [confirming, setConfirming] = useState<number | null>(null);
  const removable = canRemoveMembers(channel);
  const { addPeople } = channelMenu(channel);
  const name = channel.name ?? "";

  const close = (next: boolean) => {
    if (!next) setConfirming(null);
    onOpenChange(next);
  };

  const removeMember = (member: ChatUserSummary) =>
    remove.mutate(
      { channelId: channel.id, userId: member.id },
      {
        onSuccess: () => {
          setConfirming(null);
          toast.success(`Removed ${member.username} from #${name}`);
        },
        onError: (err) => {
          // A 404 means they already left or someone else removed them;
          // refetch so the row goes away instead of failing on every retry.
          setConfirming(null);
          void members.refetch();
          toast.error(
            userFacingError(err, "Couldn't remove them from the channel."),
          );
        },
      },
    );

  const list = members.data ?? [];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Members of #{name}</DialogTitle>
          <DialogDescription>
            {members.data
              ? list.length === 1
                ? "1 person is in this channel."
                : `${list.length} people are in this channel.`
              : "Everyone in this channel."}
          </DialogDescription>
        </DialogHeader>

        {addPeople && (
          <Button
            variant="outline"
            className="justify-self-start pointer-coarse:min-h-11"
            onClick={() => {
              close(false);
              onAddPeople();
            }}
          >
            <IconUserPlus />
            Add people
          </Button>
        )}

        {members.isError ? (
          <p className="py-3 text-sm text-muted-foreground">
            Couldn't load the members of this channel.{" "}
            <button
              type="button"
              onClick={() => void members.refetch()}
              className="rounded-sm font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Try again
            </button>
          </p>
        ) : members.isPending ? (
          <p className="py-3 text-sm text-muted-foreground">Loading people…</p>
        ) : (
          <ul
            className="-mx-1 flex max-h-80 flex-col overflow-y-auto"
            aria-label="Channel members"
          >
            {list.map((m) => {
              const isMe = m.id === meId;
              const author = {
                userId: String(m.id),
                username: m.username,
                photo: m.photo ?? undefined,
              };
              if (confirming === m.id) {
                return (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 text-sm">
                      Remove {m.username} from #{name}?
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="pointer-coarse:min-h-11"
                        onClick={() => setConfirming(null)}
                        disabled={remove.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="pointer-coarse:min-h-11"
                        onClick={() => removeMember(m)}
                        disabled={remove.isPending}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              }
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-2 px-2 py-1.5 pointer-coarse:min-h-11"
                >
                  <AuthorAvatar author={author} size="md" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {m.username}
                    {isMe && (
                      <span className="text-muted-foreground"> (you)</span>
                    )}
                  </span>
                  {removable && !isMe && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground pointer-coarse:min-h-11"
                      aria-label={`Remove ${m.username}`}
                      onClick={() => setConfirming(m.id)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
