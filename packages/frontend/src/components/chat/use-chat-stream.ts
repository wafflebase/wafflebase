import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  CHAT_PAGE_SIZE,
  chatStreamUrl,
  fetchMessage,
  fetchMessages,
  type ChannelSummary,
  type ChatMessageDto,
  type StreamUpdateEvent,
} from "@/api/chat";
import type { User } from "@/types/users";
import {
  applyChatEvent,
  chatKeys,
  lastSeqOf,
  markMessageDeleted,
  mergeMessages,
  parseStreamMessage,
  parseStreamUpdate,
  replaceMessage,
} from "./chat-cache";
import { setChatConnection } from "./chat-connection";

/** The channel whose conversation is on screen, if any. */
export interface OpenChatChannel {
  workspaceId: string;
  channelId: string;
}

let openChannel: OpenChatChannel | null = null;

/**
 * Record which channel is on screen. The stream is mounted once per session, far
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
/**
 * The earliest start asked for while a channel's catch-up was running. A
 * rerun starts there rather than at the tail it finds, which a local post can
 * have moved past a message nobody has fetched yet.
 */
const rerunAfter = new Map<string, number | undefined>();
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

function earlier(a: number | undefined, b: number | undefined) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/**
 * Fetch everything after the cached tail of a channel and merge it in. Runs
 * at most once per channel at a time; a request made while one is running
 * runs again after it, from the earliest point any request asked for. A
 * channel with no cache yet is skipped — its view's own query loads it — while
 * one that loaded empty fetches from the start.
 *
 * `afterHint` can only move the start earlier; passing the seq before the
 * oldest cached message re-reads the whole loaded range, which is how a
 * reconnect picks up edits and deletes it missed.
 */
export function catchUpChannel(
  queryClient: QueryClient,
  workspaceId: string,
  channelId: string,
  afterHint?: number,
): Promise<void> {
  const key = chatKeys.messages(channelId);
  const running = inFlight.get(channelId);
  if (running) {
    // Pin the start now: by the time the rerun reads the tail, a local post
    // may have moved it past what this request was asking for. A request
    // without a hint was asking for everything after today's tail.
    const cached = queryClient.getQueryData<ChatMessageDto[]>(key);
    const start =
      afterHint ?? (cached ? (lastSeqOf(cached) ?? 0) : undefined);
    rerunAfter.set(
      channelId,
      rerunAfter.has(channelId)
        ? earlier(rerunAfter.get(channelId), start)
        : start,
    );
    return running;
  }

  const run = async () => {
    const cached = queryClient.getQueryData<ChatMessageDto[]>(key);
    if (cached === undefined) {
      if (queryClient.getQueryState(key)?.fetchStatus === "fetching") {
        pendingAfterLoad.add(channelId);
      }
      return;
    }
    // A channel that loaded empty has everything after seq 0 to fetch.
    const cachedTail = lastSeqOf(cached) ?? 0;
    // The hint can only move the start earlier: starting past the cached tail
    // would leave a gap.
    let after = earlier(afterHint, cachedTail)!;
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
      if (rerunAfter.has(channelId)) {
        const hint = rerunAfter.get(channelId);
        rerunAfter.delete(channelId);
        void catchUpChannel(queryClient, workspaceId, channelId, hint);
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
 * The newest refresh started per message id; see `refreshMessage`. The
 * numbers come from one counter that only ever grows, so a finished refresh
 * dropping its entry cannot hand its number to a later one while an older
 * request still holds it.
 */
const refreshGeneration = new Map<string, number>();
let lastRefreshGeneration = 0;

/**
 * Apply an edit or delete announced by an `update` event. Cached pages never
 * refetch on their own (`staleTime: Infinity`), so without this a peer would
 * keep showing the old text. The message is refetched by id and replaced
 * wherever it is cached: its channel, its thread, and — for a root — the
 * thread it heads. A message the caller can no longer fetch is shown deleted.
 */
export async function refreshMessage(
  queryClient: QueryClient,
  e: StreamUpdateEvent,
): Promise<void> {
  const keys = [
    chatKeys.messages(e.channelId),
    chatKeys.thread(e.threadRootId ?? e.messageId),
  ];
  // Nothing on screen holds it: skip the request.
  if (keys.every((key) => !queryClient.getQueryData(key))) return;
  // Two updates in a row (an edit, then a delete) race; only the latest
  // request's answer may land, or the older one can resurrect the edit.
  const generation = ++lastRefreshGeneration;
  refreshGeneration.set(e.messageId, generation);
  try {
    const next = await fetchMessage(e.workspaceId, e.messageId);
    if (refreshGeneration.get(e.messageId) !== generation) return;
    for (const key of keys) {
      queryClient.setQueryData<ChatMessageDto[]>(key, (old) =>
        next ? replaceMessage(old, next) : markMessageDeleted(old, e.messageId),
      );
    }
  } catch (err) {
    console.warn("[chat] message refresh failed", err);
  } finally {
    if (refreshGeneration.get(e.messageId) === generation) {
      refreshGeneration.delete(e.messageId);
    }
  }
}

/**
 * Subscribe to `GET /chat/stream`. Mounted once per signed-in session, by
 * `ChatStreamHost`.
 *
 * The stream carries ids only. A `message` event marks another channel
 * unread, fetches what the open channel is missing, and invalidates a thread.
 * An `update` event (an edit or delete) refetches that one message.
 * `ready` arrives on every (re)connect, and again when the server's bus
 * listener reconnected. Anything may have been missed — appends, but also
 * edits and deletes — so it refreshes every channel list, re-reads the open
 * channel's whole loaded range in place (keeping the history scrolled back
 * through), and invalidates every thread and every other cached channel, which
 * then refetch when shown.
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
    // One timer per workspace: a burst in one must not cancel another's
    // pending refresh.
    const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const scheduleChannelsRefresh = (workspaceId: string) => {
      clearTimeout(refreshTimers.get(workspaceId));
      refreshTimers.set(
        workspaceId,
        setTimeout(() => {
          refreshTimers.delete(workspaceId);
          void queryClient.invalidateQueries({
            queryKey: chatKeys.channels(workspaceId),
          });
        }, CHANNELS_REFRESH_MS),
      );
    };

    const onReady = () => {
      setChatConnection("live");
      void queryClient.invalidateQueries({ queryKey: chatKeys.allChannels });
      void queryClient.invalidateQueries({ queryKey: chatKeys.allThreads });
      const open = getOpenChatChannel();
      const openKey = open ? chatKeys.messages(open.channelId) : null;
      // A wholesale refetch would drop the older pages of the channel on
      // screen, so that one is re-read in place below instead.
      void queryClient.invalidateQueries({
        queryKey: chatKeys.allMessages,
        predicate: (q) => !openKey || q.queryKey[2] !== openKey[2],
      });
      if (open) {
        const oldest = queryClient.getQueryData<ChatMessageDto[]>(openKey!)?.[0];
        void catchUpChannel(
          queryClient,
          open.workspaceId,
          open.channelId,
          oldest ? oldest.seq - 1 : undefined,
        );
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

    const onUpdate = (event: MessageEvent<string>) => {
      const e = parseStreamUpdate(event.data);
      if (e) void refreshMessage(queryClient, e);
    };

    // While CONNECTING the browser is retrying on its own; CLOSED means it
    // gave up, and only a reload starts a new stream.
    const onError = () => {
      if (source.readyState === EventSource.CLOSED) {
        console.warn("[chat] stream closed; live updates stopped");
        setChatConnection("stopped");
      } else {
        setChatConnection("reconnecting");
      }
    };

    source.addEventListener("ready", onReady);
    source.addEventListener("message", onMessage as EventListener);
    source.addEventListener("update", onUpdate as EventListener);
    source.addEventListener("error", onError);
    return () => {
      for (const timer of refreshTimers.values()) clearTimeout(timer);
      source.removeEventListener("ready", onReady);
      source.removeEventListener("message", onMessage as EventListener);
      source.removeEventListener("update", onUpdate as EventListener);
      source.removeEventListener("error", onError);
      source.close();
      setChatConnection("connecting");
    };
  }, [enabled, queryClient]);
}
