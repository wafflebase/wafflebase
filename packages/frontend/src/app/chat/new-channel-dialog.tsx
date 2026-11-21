import { useEffect, useState, type FormEvent } from "react";
import { IconHash } from "@tabler/icons-react";
import { toast } from "sonner";

import type { ChannelSummary } from "@/api/chat";
import { userFacingError } from "@/api/http-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCreateChannel, useJoinChannel } from "@/components/chat/use-chat";
import {
  channelNameHint,
  normalizeChannelName,
  validChannelName,
} from "./channel-name";

interface NewChannelDialogProps {
  workspaceId: string;
  channels: ChannelSummary[];
  open: boolean;
  /** The tab the dialog opens on; "Browse channels" opens on Browse. */
  initialTab?: "create" | "browse";
  onOpenChange: (open: boolean) => void;
  onOpened: (channelId: string) => void;
}

/**
 * Create a channel, or browse the public channels the caller has not joined
 * yet — those stay out of the channel list so it holds only what you follow.
 */
export function NewChannelDialog({
  workspaceId,
  channels,
  open,
  initialTab = "create",
  onOpenChange,
  onOpened,
}: NewChannelDialogProps) {
  const [tab, setTab] = useState<"create" | "browse">(initialTab);
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const create = useCreateChannel(workspaceId);
  const join = useJoinChannel(workspaceId);

  const normalized = normalizeChannelName(name);
  const hint = channelNameHint(name, "created");
  const invalid = hint.invalid;
  const browsable = channels
    .filter((c) => c.kind === "public" && !c.isMember && !c.archived)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  const close = (next: boolean) => {
    if (!next) {
      setName("");
      setTopic("");
      setIsPrivate(false);
      setTab("create");
    }
    onOpenChange(next);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validChannelName(normalized) || create.isPending) return;
    create.mutate(
      {
        kind: isPrivate ? "private" : "public",
        name: normalized,
        topic: topic.trim() || undefined,
      },
      {
        onSuccess: (channel) => {
          close(false);
          onOpened(channel.id);
        },
        onError: (err) =>
          toast.error(
            userFacingError(err, "Couldn't create the channel. Try again."),
          ),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Channels</DialogTitle>
          <DialogDescription>
            Create a channel for a topic, or join one that already exists.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="create">Create</TabsTrigger>
            <TabsTrigger value="browse">
              Browse{browsable.length > 0 ? ` (${browsable.length})` : ""}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="create">
            <form onSubmit={submit} className="mt-2 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-channel-name">Name</Label>
                <Input
                  id="new-channel-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. q4-planning"
                  aria-invalid={invalid || undefined}
                  aria-describedby="new-channel-name-hint"
                  maxLength={80}
                  autoFocus
                />
                <p
                  id="new-channel-name-hint"
                  className={
                    invalid
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {hint.text}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-channel-topic">
                  Topic <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="new-channel-topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="What is this channel about?"
                />
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="new-channel-private"
                  checked={isPrivate}
                  onCheckedChange={(v) => setIsPrivate(v === true)}
                  className="mt-0.5"
                />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="new-channel-private">Make private</Label>
                  <p className="text-xs text-muted-foreground">
                    Only people you add can read it. Its name is still reserved across
                    the workspace.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => close(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!validChannelName(normalized) || create.isPending}
                >
                  Create channel
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
          <TabsContent value="browse">
            {browsable.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                You're in every public channel here.
              </p>
            ) : (
              <ul className="mt-2 flex max-h-80 flex-col overflow-y-auto">
                {browsable.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 border-b py-2 last:border-b-0"
                  >
                    <IconHash className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      {c.topic && (
                        <p className="truncate text-xs text-muted-foreground">
                          {c.topic}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        close(false);
                        onOpened(c.id);
                      }}
                    >
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={join.isPending}
                      onClick={() =>
                        join.mutate(c.id, {
                          onSuccess: () => {
                            close(false);
                            onOpened(c.id);
                          },
                          onError: (err) =>
                            toast.error(
                              userFacingError(err, "Couldn't join the channel."),
                            ),
                        })
                      }
                    >
                      Join
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
