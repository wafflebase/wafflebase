import { type ComponentProps } from "react";
import { IconMessages } from "@tabler/icons-react";

import { ChunkBoundary } from "@/components/chunk-boundary";
import { HeaderPanelToggle } from "@/components/site-header";
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import { useChatPanel } from "./chat-panel-context";

const ChatPanelImpl = lazyWithRetry(() =>
  import("./chat-panel").then((module) => ({ default: module.ChatPanel })),
);

/**
 * Code-split wrapper around {@link import('./chat-panel').ChatPanel}, shared
 * by every editor so they load one chunk, and only once the panel opens —
 * the conversation tree is most of the Chat page and most editor visits
 * never open it. Same arrangement as `LazyHistoryPanel`.
 */
export function LazyChatPanel(props: ComponentProps<typeof ChatPanelImpl>) {
  return (
    <ChunkBoundary fallback={null}>
      <ChatPanelImpl {...props} />
    </ChunkBoundary>
  );
}

/**
 * The header's Chat toggle, beside comments and version history. On a phone
 * `SiteHeader` puts it in the More menu, as it does the other panels. Must
 * render inside a `ChatPanelProvider`.
 */
export function ChatPanelToggle() {
  const panel = useChatPanel();
  return (
    <HeaderPanelToggle
      icon={IconMessages}
      label="chat"
      pressed={panel.isOpen}
      onPressedChange={(next) => (next ? panel.open() : panel.close())}
    />
  );
}
