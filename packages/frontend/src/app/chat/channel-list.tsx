import { useState } from "react";
import { Link } from "react-router-dom";
import {
  IconArchive,
  IconChevronRight,
  IconHash,
  IconListSearch,
  IconLock,
  IconPlus,
} from "@tabler/icons-react";

import type { ChannelSummary } from "@/api/chat";
import { channelCount } from "@/components/chat/chat-cache";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuthorAvatar } from "@/components/comments/components/AuthorAvatar";
import { cn } from "@/lib/utils";
import {
  browsableChannels,
  channelLabel,
  groupChannels,
} from "./group-channels";

const ARCHIVED_OPEN_KEY = (workspaceId: string) =>
  `wafflebase:chat-archived-open:${workspaceId}`;

function readArchivedOpen(workspaceId: string): boolean {
  try {
    return window.localStorage.getItem(ARCHIVED_OPEN_KEY(workspaceId)) === "1";
  } catch {
    return false;
  }
}

function writeArchivedOpen(workspaceId: string, open: boolean): void {
  try {
    if (open) window.localStorage.setItem(ARCHIVED_OPEN_KEY(workspaceId), "1");
    else window.localStorage.removeItem(ARCHIVED_OPEN_KEY(workspaceId));
  } catch {
    // A convenience only.
  }
}

interface ChannelListProps {
  /** Keys the remembered state of the Archived section. */
  workspaceId: string;
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
  /** Opens the channel dialog on its Browse tab. */
  onBrowse: () => void;
  onNewMessage: () => void;
}

/**
 * The Chat page's second column: Channels, Direct messages, then — only when
 * there are any — the archived channels the caller is in, collapsed. An unread
 * channel's name is bold; a mention, or anything unread in a DM, shows as a
 * count, other unread as a dot. Archived channels show neither: nothing can
 * be posted there, and the Chat badge does not count them either.
 *
 * A public channel open as a preview — not joined — shows in Channels in
 * italics while it is open. "Browse channels" closes the section whenever
 * there are public channels the caller has not joined.
 */
export function ChannelList({
  workspaceId,
  channels,
  isLoading,
  isError = false,
  onRetry,
  activeChannelId,
  me,
  hrefFor,
  onNewChannel,
  onBrowse,
  onNewMessage,
}: ChannelListProps) {
  const {
    channels: rooms,
    directMessages,
    archived,
  } = groupChannels(channels, activeChannelId);
  const browsable = browsableChannels(channels).live.length;
  const ready = !isLoading && !isError;

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
                transient={!c.isMember}
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
          {ready && browsable > 0 && (
            <li>
              <button
                type="button"
                onClick={onBrowse}
                aria-label={`Browse channels, ${browsable} not joined`}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
              >
                <IconListSearch aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">
                  Browse channels
                </span>
                <span className="shrink-0 text-xs tabular-nums">
                  {browsable}
                </span>
              </button>
            </li>
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
            directMessages.map((c) => (
              <ChannelRow
                key={c.id}
                channel={c}
                label={channelLabel(c, me)}
                active={c.id === activeChannelId}
                href={hrefFor(c.id)}
                icon={<DmAvatar channel={c} me={me} />}
              />
            ))
          )}
        </Section>
        {ready && archived.length > 0 && (
          <ArchivedSection
            // Remount per workspace so the remembered state is read afresh.
            key={workspaceId}
            workspaceId={workspaceId}
            channels={archived}
            activeChannelId={activeChannelId}
            hrefFor={hrefFor}
          />
        )}
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
          className="size-7 pointer-coarse:size-11"
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

function ArchivedSection({
  workspaceId,
  channels,
  activeChannelId,
  hrefFor,
}: {
  workspaceId: string;
  channels: ChannelSummary[];
  activeChannelId: string | null;
  hrefFor: (channelId: string) => string;
}) {
  const [open, setOpen] = useState(() => readArchivedOpen(workspaceId));
  const toggle = () => {
    setOpen(!open);
    writeArchivedOpen(workspaceId, !open);
  };
  // Collapsed, the open channel still shows, so the list never loses track
  // of where you are.
  const shown = open ? channels : channels.filter((c) => c.id === activeChannelId);

  return (
    <section className="mt-4">
      <h2 className="pb-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
        >
          <IconChevronRight
            aria-hidden
            className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
          />
          Archived
          <span className="tabular-nums">({channels.length})</span>
        </button>
      </h2>
      {shown.length > 0 && (
        <ul className="flex flex-col gap-px">
          {shown.map((c) => (
            <ChannelRow
              key={c.id}
              channel={c}
              label={c.name ?? ""}
              active={c.id === activeChannelId}
              href={hrefFor(c.id)}
              archived
              transient={!c.isMember}
              icon={<IconArchive className="size-4 shrink-0 text-muted-foreground" />}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

const avatarOf = (m: ChannelSummary["members"][number]) => ({
  userId: String(m.id),
  username: m.username,
  photo: m.photo ?? undefined,
});

/**
 * A DM's icon: the other person's avatar, or for a group DM two of the
 * others' stacked corner to corner, so a conversation with six people does
 * not read as a one-to-one. The label already names everyone.
 */
function DmAvatar({ channel, me }: { channel: ChannelSummary; me: number }) {
  const others = channel.members.filter((m) => m.id !== me);
  if (others.length >= 2) {
    return (
      <span aria-hidden className="relative size-5 shrink-0">
        <span className="absolute top-0 left-0 flex">
          <AuthorAvatar author={avatarOf(others[0])} />
        </span>
        <span className="absolute right-0 bottom-0 flex rounded-full ring-2 ring-background">
          <AuthorAvatar author={avatarOf(others[1])} />
        </span>
      </span>
    );
  }
  const other = others[0] ?? channel.members[0];
  if (!other) return null;
  return (
    <span aria-hidden className="flex shrink-0">
      <AuthorAvatar author={avatarOf(other)} size="md" />
    </span>
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
  archived = false,
  transient = false,
}: {
  channel: ChannelSummary;
  label: string;
  active: boolean;
  href: string;
  icon: React.ReactNode;
  /** Muted, with no unread marks. */
  archived?: boolean;
  /** Open as a preview, not joined: shown only while it is open. */
  transient?: boolean;
}) {
  const unread = !archived && channel.unreadCount > 0;
  const count = archived ? 0 : channelCount(channel);
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
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            unread && "font-semibold",
            transient && "italic",
          )}
        >
          {label}
        </span>
        {transient && <span className="sr-only">, not joined</span>}
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
