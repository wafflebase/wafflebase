import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  CHAT_PAGE_SIZE,
  chatStreamUrl,
  fetchMessages,
  type ChannelSummary,
  type ChatMessageDto,
} from "@/api/chat";
import type { User } from "@/types/users";
import {
  applyChatEvent,
  chatKeys,
  lastSeqOf,
  mergeMessages,
  parseStreamMessage,
} from "./chat-cache";

/** The channel whose conversation is on screen, if any. */
export interface OpenChatChannel {
  workspaceId: string;
  channelId: string;
}

let openChannel: OpenChatChannel | null = null;

/**
 * Record which channel is on screen. The stream is mounted once per shell, far
 * from the conversation, so this module-level slot is how it learns which
 * channel to keep fresh rather than mark unread.
 */
export function setOpenChatChannel(next: OpenChatChannel | null): void {
  openChannel = next;
}

export function getOpenChatChannel(): OpenChatChannel | null {
  return openChannel;
}

/** A catch-up larger than this many pages gives up and refetches the tail. */
const MAX_CATCH_UP_PAGES = 20;
/** Coalesce channel-list refreshes when messages arrive in a burst. */
const CHANNELS_REFRESH_MS = 1000;

const inFlight = new Map<string, Promise<void>>();
const rerun = new Set<string>();
/** Channels that heard an event while their first page was still loading. */
const pendingAfterLoad = new Set<string>();

/**
 * Whether a catch-up was asked for while this channel's first page loaded.
 * That page may have been read before the announced message was written, so
 * its view catches up once the page lands.
 */
export function takePendingCatchUp(channelId: string): boolean {
  return pendingAfterLoad.delete(channelId);
}

/**
 * Fetch everything after the cached tail of a channel and merge it in. Runs
 * at most once per channel at a time; a request made while one is running
 * runs again after it, from the tail that one left. A channel with no cache
 * yet is skipped — its view's own query loads it.
 */
export function catchUpChannel(
  queryClient: QueryClient,
  workspaceId: string,
  channelId: string,
  afterHint?: number,
): Promise<void> {
  const running = inFlight.get(channelId);
  if (running) {
    rerun.add(channelId);
    return running;
  }

  const run = async () => {
    const key = chatKeys.messages(channelId);
    const cachedTail = lastSeqOf(
      queryClient.getQueryData<ChatMessageDto[]>(key),
    );
    if (cachedTail === null) {
      if (queryClient.getQueryState(key)?.fetchStatus === "fetching") {
        pendingAfterLoad.add(channelId);
      }
      return;
    }
    // The hint can only move the start earlier: starting past the cached tail
    // would leave a gap.
    let after =
      afterHint !== undefined ? Math.min(afterHint, cachedTail) : cachedTail;
    for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
      const batch = await fetchMessages(workspaceId, channelId, { after });
      if (batch.length > 0) {
        queryClient.setQueryData<ChatMessageDto[]>(key, (old) =>
          mergeMessages(old, batch),
        );
      }
      if (batch.length < CHAT_PAGE_SIZE) return;
      after = lastSeqOf(batch) ?? after;
    }
    // Too far behind to page forward; take the latest page instead.
    await queryClient.resetQueries({ queryKey: key, exact: true });
  };

  const promise = run()
    .catch((err) => console.warn("[chat] catch-up failed", err))
    .finally(() => {
      inFlight.delete(channelId);
      if (rerun.delete(channelId)) {
        void catchUpChannel(queryClient, workspaceId, channelId);
      }
    });
  inFlight.set(channelId, promise);
  return promise;
}

/**
 * Refresh a thread root's row (its reply count and last reply time moved)
 * when that root is cached. Fetching the page that starts at the root replaces
 * it, and anything after it, by id.
 */
async function refreshRoot(
  queryClient: QueryClient,
  workspaceId: string,
  channelId: string,
  rootId: string,
): Promise<void> {
  const key = chatKeys.messages(channelId);
  const root = queryClient
    .getQueryData<ChatMessageDto[]>(key)
    ?.find((m) => m.id === rootId);
  if (!root) return;
  try {
    const batch = await fetchMessages(workspaceId, channelId, {
      after: root.seq - 1,
    });
    queryClient.setQueryData<ChatMessageDto[]>(key, (old) =>
      mergeMessages(old, batch),
    );
  } catch (err) {
    console.warn("[chat] thread root refresh failed", err);
  }
}

/**
 * Subscribe to `GET /chat/stream`, once per shell.
 *
 * The stream carries ids only. A `message` event marks another channel
 * unread, fetches what the open channel is missing, and invalidates a thread.
 * `ready` arrives on every (re)connect: it refreshes every channel list and
 * catches the open channel up from its last cached seq, so a dropped
 * connection or a missed NOTIFY costs latency rather than messages.
 */
export function useChatStream(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // No EventSource (an old browser, a test environment): the lists still
    // load, they just do not update live.
    if (!enabled || typeof EventSource === "undefined") return;

    const source = new EventSource(chatStreamUrl(), {
      withCredentials: true,
    });
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleChannelsRefresh = (workspaceId: string) => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void queryClient.invalidateQueries({
          queryKey: chatKeys.channels(workspaceId),
        });
      }, CHANNELS_REFRESH_MS);
    };

    const onReady = () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.allChannels });
      const open = getOpenChatChannel();
      if (open) {
        void catchUpChannel(queryClient, open.workspaceId, open.channelId);
      }
    };

    const onMessage = (event: MessageEvent<string>) => {
      const e = parseStreamMessage(event.data);
      if (!e) return;
      const me = queryClient.getQueryData<User>(["me"])?.id ?? -1;
      const open = getOpenChatChannel();
      const listKey = chatKeys.channels(e.workspaceId);
      const channels = queryClient.getQueryData<ChannelSummary[]>(listKey);

      const outcome = applyChatEvent(
        {
          channels: channels ?? [],
          openChannelId:
            open && open.workspaceId === e.workspaceId ? open.channelId : null,
          me,
        },
        e,
      );

      if (channels) queryClient.setQueryData(listKey, outcome.channels);
      // The list orders DMs by recency and owns the mention count, and an
      // unknown channel is a DM someone just opened with us.
      scheduleChannelsRefresh(e.workspaceId);

      if (outcome.fetchAfter) {
        void catchUpChannel(
          queryClient,
          e.workspaceId,
          outcome.fetchAfter.channelId,
          outcome.fetchAfter.seq,
        );
      }
      if (outcome.invalidateThread) {
        void queryClient.invalidateQueries({
          queryKey: chatKeys.thread(outcome.invalidateThread),
        });
        void refreshRoot(
          queryClient,
          e.workspaceId,
          e.channelId,
          outcome.invalidateThread,
        );
      }
    };

    const onError = () => {
      if (source.readyState === EventSource.CLOSED) {
        console.warn("[chat] stream closed; live updates stopped");
      }
    };

    source.addEventListener("ready", onReady);
    source.addEventListener("message", onMessage as EventListener);
    source.addEventListener("error", onError);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      source.removeEventListener("ready", onReady);
      source.removeEventListener("message", onMessage as EventListener);
      source.removeEventListener("error", onError);
      source.close();
    };
  }, [enabled, queryClient]);
}
