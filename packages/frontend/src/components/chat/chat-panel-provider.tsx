import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { fetchMe } from "@/api/auth";

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
  available = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * False while the page withholds the panel — a revision preview, since
   * "Send to chat" reads the live selection the preview covers.
   */
  available?: boolean;
  children: ReactNode;
}) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  const [draftSeed, setDraftSeed] = useState(0);
  // Drafts are keyed by user, so a draft asked for before the signed-in user
  // is known waits as pending rather than being stored under nobody.
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const userId = me?.id;

  const openPanel = useCallback(
    (opts?: ChatPanelOpenOptions) => {
      if (opts?.channelId) setChannelId(opts.channelId);
      if (opts?.draft) {
        if (opts.channelId && userId !== undefined) {
          seedChatDraft(userId, opts.channelId, opts.draft);
          setDraftSeed((n) => n + 1);
        } else {
          setPendingDraft(opts.draft);
        }
      }
      onOpenChange(true);
    },
    [onOpenChange, userId],
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
      if (pendingDraft === null || userId === undefined) return;
      seedChatDraft(userId, target, pendingDraft);
      setPendingDraft(null);
      setDraftSeed((n) => n + 1);
    },
    [pendingDraft, userId],
  );

  const api = useMemo<ChatPanelApi>(
    () => ({ open: openPanel, close, isOpen: open }),
    [openPanel, close, open],
  );
  const value = useMemo<ChatPanelState>(
    () => ({
      api,
      available,
      channelId,
      selectChannel: setChannelId,
      pendingDraft,
      takePendingDraft,
      draftSeed,
    }),
    [api, available, channelId, pendingDraft, takePendingDraft, draftSeed],
  );

  return (
    <ChatPanelContext.Provider value={value}>
      {children}
    </ChatPanelContext.Provider>
  );
}
