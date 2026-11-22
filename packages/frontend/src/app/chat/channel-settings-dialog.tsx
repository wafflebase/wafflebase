import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { ChannelSummary } from "@/api/chat";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateChannel } from "@/components/chat/use-chat";
import {
  channelNameHint,
  normalizeChannelName,
  validChannelName,
} from "./channel-name";

/** The server's `MAX_TOPIC_LENGTH` (chat.dto.ts). */
const TOPIC_MAX = 250;

export type ChannelSettingsMode = "rename" | "topic" | "archive";

interface ChannelSettingsDialogProps {
  workspaceId: string;
  channel: ChannelSummary;
  /** Which change the dialog is for; null keeps it closed. */
  mode: ChannelSettingsMode | null;
  onClose: () => void;
}

/**
 * Rename a channel, edit its topic, or archive it — the three changes
 * `canManage` allows. Archiving asks inside the dialog, because it stops
 * everybody posting and is the one of the three a slip should not do.
 */
export function ChannelSettingsDialog({
  workspaceId,
  channel,
  mode,
  onClose,
}: ChannelSettingsDialogProps) {
  const update = useUpdateChannel(workspaceId);
  const [name, setName] = useState(channel.name ?? "");
  const [topic, setTopic] = useState(channel.topic ?? "");

  // Each opening starts from the channel as it is now.
  useEffect(() => {
    if (mode === null) return;
    setName(channel.name ?? "");
    setTopic(channel.topic ?? "");
  }, [mode, channel.name, channel.topic]);

  const normalized = normalizeChannelName(name);
  const hint = channelNameHint(name, "renamed");
  const nameUnchanged = normalized === channel.name;
  const topicUnchanged = topic.trim() === (channel.topic ?? "");

  const save = (
    patch: { name?: string; topic?: string; archived?: boolean },
    failure: string,
    success?: string,
  ) =>
    update.mutate(
      { channelId: channel.id, ...patch },
      {
        onSuccess: () => {
          if (success) toast.success(success);
          onClose();
        },
        onError: (err) => toast.error(userFacingError(err, failure)),
      },
    );

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    if (!validChannelName(normalized) || nameUnchanged || update.isPending) {
      return;
    }
    save({ name: normalized }, "Couldn't rename the channel. Try again.");
  };

  const submitTopic = (e: FormEvent) => {
    e.preventDefault();
    if (topicUnchanged || update.isPending) return;
    // An empty string clears the topic on the server.
    save({ topic: topic.trim() }, "Couldn't save the topic. Try again.");
  };

  return (
    <Dialog open={mode !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {mode === "rename" && (
          <form onSubmit={submitName} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Rename channel</DialogTitle>
              <DialogDescription>
                Links to #{channel.name} keep working under the new name.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rename-channel-name">Name</Label>
              <Input
                id="rename-channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={hint.invalid || undefined}
                aria-describedby="rename-channel-name-hint"
                maxLength={80}
                autoFocus
              />
              <p
                id="rename-channel-name-hint"
                className={
                  hint.invalid
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {hint.text}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !validChannelName(normalized) ||
                  nameUnchanged ||
                  update.isPending
                }
              >
                Rename
              </Button>
            </DialogFooter>
          </form>
        )}

        {mode === "topic" && (
          <form onSubmit={submitTopic} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Edit topic</DialogTitle>
              <DialogDescription>
                Shown beside the channel name. Leave it empty to remove it.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="channel-topic">Topic</Label>
              <Input
                id="channel-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What is this channel about?"
                maxLength={TOPIC_MAX}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={topicUnchanged || update.isPending}
              >
                Save topic
              </Button>
            </DialogFooter>
          </form>
        )}

        {mode === "archive" && (
          <>
            <DialogHeader>
              <DialogTitle>Archive #{channel.name}?</DialogTitle>
              <DialogDescription>
                Nobody will be able to post in it. It moves to Archived in the
                channel list, where everyone who can see it now can still read
                its history, and it can be unarchived later.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={update.isPending}
                onClick={() =>
                  save(
                    { archived: true },
                    "Couldn't archive the channel. Try again.",
                    `Archived #${channel.name}`,
                  )
                }
              >
                Archive channel
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
