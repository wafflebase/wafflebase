import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconHash, IconLock, IconUser, IconUsers } from "@tabler/icons-react";

import type { ChannelSummary } from "@/api/chat";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { switcherItems, type SwitcherItem } from "./group-channels";

interface ChannelSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: ChannelSummary[];
  me: number;
  onPick: (channelId: string) => void;
}

/**
 * Mod+K: jump to a channel or DM by typing part of its name. A combobox over
 * a listbox — ↑/↓ move, Enter opens, Esc closes — rather than a command
 * palette, since the page has nothing but channels to jump to.
 */
export function ChannelSwitcher({
  open,
  onOpenChange,
  channels,
  me,
  onPick,
}: ChannelSwitcherProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const items = useMemo(
    () => switcherItems(channels, me, query),
    [channels, me, query],
  );

  // Each opening starts empty, at the top.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
  }, [open]);

  const index = Math.min(active, Math.max(items.length - 1, 0));
  const activeItem = items[index];

  useEffect(() => {
    // jsdom has no scrollIntoView; a real browser always does.
    listRef.current?.children[index]?.scrollIntoView?.({ block: "nearest" });
  }, [index, items]);

  const pick = (item: SwitcherItem) => {
    onOpenChange(false);
    onPick(item.channel.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((index + step + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeItem) pick(activeItem);
    }
  };

  const optionId = (item: SwitcherItem) => `chat-switcher-${item.channel.id}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] translate-y-0 gap-0 p-0 sm:max-w-md">
        <DialogTitle className="sr-only">Switch channel</DialogTitle>
        <DialogDescription className="sr-only">
          Type to filter channels and direct messages, then press Enter.
        </DialogDescription>
        <div className="border-b p-3 pr-12">
          <input
            role="combobox"
            aria-expanded
            aria-controls="chat-switcher-list"
            aria-activedescendant={activeItem ? optionId(activeItem) : undefined}
            aria-autocomplete="list"
            aria-label="Jump to a channel or person"
            placeholder="Jump to…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            autoFocus
            className="caret-primary placeholder:text-muted-foreground h-9 w-full bg-transparent px-1 text-base outline-none md:text-sm"
          />
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No channels or people match “{query.trim()}”.
          </p>
        ) : (
          <ul
            ref={listRef}
            id="chat-switcher-list"
            role="listbox"
            aria-label="Channels and direct messages"
            className="max-h-80 overflow-y-auto p-1"
          >
            {items.map((item, i) => (
              <li
                key={item.channel.id}
                id={optionId(item)}
                role="option"
                aria-selected={i === index}
                // Keep focus in the input, where typing continues.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(item)}
                onMouseMove={() => i !== index && setActive(i)}
                className={cn(
                  "flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-sm pointer-coarse:min-h-11",
                  i === index && "bg-accent text-accent-foreground",
                )}
              >
                <SwitcherIcon channel={item.channel} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.joinable && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Not joined
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SwitcherIcon({ channel }: { channel: ChannelSummary }) {
  const className = "size-4 shrink-0 text-muted-foreground";
  if (channel.kind === "private") return <IconLock aria-hidden className={className} />;
  if (channel.kind === "dm") {
    const Icon = channel.members.length > 2 ? IconUsers : IconUser;
    return <Icon aria-hidden className={className} />;
  }
  return <IconHash aria-hidden className={className} />;
}
