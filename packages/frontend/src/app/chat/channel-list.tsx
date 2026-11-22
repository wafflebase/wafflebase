import { Link } from "react-router-dom";
import { IconHash, IconLock, IconPlus } from "@tabler/icons-react";

import type { ChannelSummary } from "@/api/chat";
import { channelCount } from "@/components/chat/chat-cache";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuthorAvatar } from "@/components/comments/components/AuthorAvatar";
import { cn } from "@/lib/utils";
import { channelLabel, groupChannels } from "./group-channels";

interface ChannelListProps {
  channels: ChannelSummary[];
  isLoading: boolean;
  /** The list failed to load; shown instead of a misleading empty state. */
  isError?: boolean;
  onRetry?: () => void;
  activeChannelId: string | null;
  me: number;
  /** Builds the link for one channel. */
  hrefFor: (channelId: string) => string;
  onNewChannel: () => void;
  onNewMessage: () => void;
}

/**
 * The Chat page's second column: Channels, then Direct messages. An unread
 * channel's name is bold; a mention, or anything unread in a DM, shows as a
 * count, other unread as a dot.
 */
export function ChannelList({
  channels,
  isLoading,
  isError = false,
  onRetry,
  activeChannelId,
  me,
  hrefFor,
  onNewChannel,
  onNewMessage,
}: ChannelListProps) {
  const { channels: rooms, directMessages } = groupChannels(channels);

  return (
    <nav aria-label="Chat channels" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <Section title="Channels" actionLabel="New channel" onAction={onNewChannel}>
          {isLoading ? (
            <Placeholder>Loading…</Placeholder>
          ) : isError ? (
            <Placeholder>
              Couldn't load channels.{" "}
              <button
                type="button"
                onClick={onRetry}
                className="rounded-sm font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Try again
              </button>
            </Placeholder>
          ) : rooms.length === 0 ? (
            <Placeholder>
              <button
                type="button"
                onClick={onNewChannel}
                className="rounded-sm text-left underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Create or join a channel
              </button>
            </Placeholder>
          ) : (
            rooms.map((c) => (
              <ChannelRow
                key={c.id}
                channel={c}
                label={c.name ?? ""}
                active={c.id === activeChannelId}
                href={hrefFor(c.id)}
                icon={
                  c.kind === "private" ? (
                    <IconLock className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <IconHash className="size-4 shrink-0 text-muted-foreground" />
                  )
                }
              />
            ))
          )}
        </Section>
        <Section
          title="Direct messages"
          actionLabel="New message"
          onAction={onNewMessage}
          className="mt-4"
        >
          {!isLoading && !isError && directMessages.length === 0 ? (
            <Placeholder>
              <button
                type="button"
                onClick={onNewMessage}
                className="rounded-sm text-left underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Message someone
              </button>
            </Placeholder>
          ) : (
            directMessages.map((c) => {
              const other = c.members.find((m) => m.id !== me) ?? c.members[0];
              return (
                <ChannelRow
                  key={c.id}
                  channel={c}
                  label={channelLabel(c, me)}
                  active={c.id === activeChannelId}
                  href={hrefFor(c.id)}
                  icon={
                    other ? (
                      <AuthorAvatar
                        author={{
                          userId: String(other.id),
                          username: other.username,
                          photo: other.photo ?? undefined,
                        }}
                        size="md"
                      />
                    ) : null
                  }
                />
              );
            })
          )}
        </Section>
      </div>
    </nav>
  );
}

function Section({
  title,
  actionLabel,
  onAction,
  className,
  children,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className} aria-label={title}>
      <div className="flex items-center justify-between px-2 pb-1">
        <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={actionLabel}
          title={actionLabel}
          onClick={onAction}
        >
          <IconPlus />
        </Button>
      </div>
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <li className="px-2 py-1.5 text-sm text-muted-foreground">{children}</li>;
}

function ChannelRow({
  channel,
  label,
  active,
  href,
  icon,
}: {
  channel: ChannelSummary;
  label: string;
  active: boolean;
  href: string;
  icon: React.ReactNode;
}) {
  const unread = channel.unreadCount > 0;
  const count = channelCount(channel);
  const description = count
    ? `${count} unread${channel.mentionCount > 0 ? ` mention${count === 1 ? "" : "s"}` : ""}`
    : unread
      ? "unread messages"
      : undefined;

  return (
    <li>
      <Link
        to={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 items-center gap-2 rounded-md px-2 text-sm outline-none pointer-coarse:min-h-11",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50",
          active
            ? "bg-selected text-selected-foreground"
            : "text-foreground hover:bg-muted",
          !active && !unread && "text-muted-foreground hover:text-foreground",
        )}
      >
        {icon}
        <span className={cn("min-w-0 flex-1 truncate", unread && "font-semibold")}>
          {label}
        </span>
        {description && <span className="sr-only">, {description}</span>}
        {count > 0 ? (
          <Badge className="h-5 min-w-5 px-1.5 text-2xs tabular-nums" aria-hidden>
            {count > 99 ? "99+" : count}
          </Badge>
        ) : unread ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-foreground"
          />
        ) : null}
      </Link>
    </li>
  );
}
