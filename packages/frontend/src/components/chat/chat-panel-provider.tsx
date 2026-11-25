import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";

import {
  ChatPanelContext,
  seedChatDraft,
  type ChatPanelApi,
  type ChatPanelOpenOptions,
  type ChatPanelState,
} from "./chat-panel-context";

/**
 * The chat panel's state for one editor. Whether it is open belongs to the
 * page's `useRightPanels` (chat shares the right-hand slot with comments and
 * history), so the page passes that flag in; which channel it shows and any
 * draft waiting for it live here.
 *
 * A `?chat=<channelId>` in the URL — what a document card in chat links to —
 * opens the panel on that channel when the editor loads. The parameter is
 * left in place, like `?at=`: the URL keeps saying where the user came from.
 */
export function ChatPanelProvider({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  const [draftSeed, setDraftSeed] = useState(0);

  const openPanel = useCallback(
    (opts?: ChatPanelOpenOptions) => {
      if (opts?.channelId) setChannelId(opts.channelId);
      if (opts?.draft) {
        if (opts.channelId) {
          seedChatDraft(opts.channelId, opts.draft);
          setDraftSeed((n) => n + 1);
        } else {
          setPendingDraft(opts.draft);
        }
      }
      onOpenChange(true);
    },
    [onOpenChange],
  );
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const [searchParams] = useSearchParams();
  const linked = searchParams.get("chat");
  useEffect(() => {
    if (linked) openPanel({ channelId: linked });
    // Only a new link reopens the panel; closing it must not bounce back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);

  const takePendingDraft = useCallback(
    (target: string) => {
      if (pendingDraft === null) return;
      seedChatDraft(target, pendingDraft);
      setPendingDraft(null);
      setDraftSeed((n) => n + 1);
    },
    [pendingDraft],
  );

  const api = useMemo<ChatPanelApi>(
    () => ({ open: openPanel, close, isOpen: open }),
    [openPanel, close, open],
  );
  const value = useMemo<ChatPanelState>(
    () => ({
      api,
      channelId,
      selectChannel: setChannelId,
      pendingDraft,
      takePendingDraft,
      draftSeed,
    }),
    [api, channelId, pendingDraft, takePendingDraft, draftSeed],
  );

  return (
    <ChatPanelContext.Provider value={value}>
      {children}
    </ChatPanelContext.Provider>
  );
}
