import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  CHAT_PAGE_SIZE,
  createChannel,
  deleteMessage,
  fetchChannelMembers,
  editMessage,
  fetchChannels,
  fetchMessages,
  inviteToChannel,
  joinChannel,
  leaveChannel,
  markRead,
  openDm,
  postMessage,
  removeChannelMember,
  updateChannel,
  type ChannelSummary,
  type ChatMessageDto,
} from "@/api/chat";
import type { User } from "@/types/users";
import {
  chatKeys,
  lastSeqOf,
  markChannelRead,
  mergeMessages,
  replaceMessage,
  type ChatLine,
  type PendingSend,
  type PostInput,
} from "./chat-cache";
import { pendingStore, updatePending } from "./pending-store";
import { classifySendFailure, newClientId } from "./send-failure";
import { catchUpChannel, takePendingCatchUp } from "./use-chat-stream";

/** Channels the caller can see in one workspace, with unread counts. */
export function useChannels(workspaceId: string | undefined) {
  return useQuery({
    queryKey: chatKeys.channels(workspaceId ?? ""),
    queryFn: () => fetchChannels(workspaceId!),
    enabled: !!workspaceId,
  });
}

/** Channels whose oldest page has been reached, so "Load older" hides. */
const exhausted = new Set<string>();
/** How many pages of replies opening a thread reads before it stops to ask. */
const THREAD_OPEN_PAGES = 10;

/**
 * A channel's top-level messages, newest page first loaded.
 *
 * The cache is appended to by the stream and prepended to by "Load older",
 * so it is never refetched wholesale (`staleTime: Infinity`): a refetch would
 * drop every older page the reader scrolled back through. Re-entering a
 * channel whose cache survived catches up from its tail instead.
 */
export function useChannelMessages(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: chatKeys.messages(channelId),
    queryFn: async () => {
      const page = await fetchMessages(workspaceId, channelId);
      if (page.length < CHAT_PAGE_SIZE) exhausted.add(channelId);
      else exhausted.delete(channelId);
      return page;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (queryClient.getQueryData(chatKeys.messages(channelId))) {
      void catchUpChannel(queryClient, workspaceId, channelId);
    }
  }, [queryClient, workspaceId, channelId]);

  useEffect(() => {
    if (query.data && takePendingCatchUp(channelId)) {
      void catchUpChannel(queryClient, workspaceId, channelId);
    }
  }, [query.data, queryClient, workspaceId, channelId]);

  const [hasOlder, setHasOlder] = useState(() => !exhausted.has(channelId));
  const [loadingOlder, setLoadingOlder] = useState(false);
  useEffect(() => setHasOlder(!exhausted.has(channelId)), [channelId, query.data]);

  /**
   * Fetch the page before the oldest cached message. Resolves to whether it
   * prepended anything: a channel holding an exact multiple of a page ends on
   * an empty one, and the view must not wait for a prepend that never comes.
   */
  const loadOlder = useCallback(async (): Promise<boolean> => {
    const oldest = query.data?.[0];
    if (!oldest || loadingOlder) return false;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(workspaceId, channelId, {
        before: oldest.seq,
      });
      if (page.length < CHAT_PAGE_SIZE) {
        exhausted.add(channelId);
        setHasOlder(false);
      }
      if (page.length === 0) return false;
      let prepended = false;
      queryClient.setQueryData<ChatMessageDto[]>(
        chatKeys.messages(channelId),
        (old) => {
          const next = mergeMessages(old, page);
          prepended = next[0]?.id !== old?.[0]?.id;
          return next;
        },
      );
      return prepended;
    } finally {
      setLoadingOlder(false);
    }
  }, [query.data, loadingOlder, workspaceId, channelId, queryClient]);

  return {
    messages: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    hasOlder: hasOlder && (query.data?.length ?? 0) > 0,
    loadingOlder,
    loadOlder,
    /** Try the first page again after it failed to load. */
    retry: query.refetch,
  };
}

/**
 * A thread, root first, ascending. It reads back from the newest reply, so a
 * long thread is never cut off at its end: opening it reads up to
 * `THREAD_OPEN_PAGES` pages, and `loadOlder` reads the rest on demand. The
 * root has the lowest `seq` in the thread, so the thread is complete exactly
 * when the root is loaded; until then `hasOlder` is set.
 *
 * The stream refetches the thread on every reply. A refetch reads back as far
 * as the cache already reached, so the earlier replies the reader paged
 * through stay put.
 */
export function useThreadMessages(
  workspaceId: string,
  channelId: string,
  rootId: string,
) {
  const queryClient = useQueryClient();
  const key = useMemo(() => chatKeys.thread(rootId), [rootId]);
  const readBack = useCallback(
    async (before: number | undefined, pages: number, floor: number) => {
      // Reads `pages` pages back from `before` (the newest without it), and
      // on past them while the oldest read is still above `floor`.
      let all: ChatMessageDto[] = [];
      for (let page = 0; ; page++) {
        const batch = await fetchMessages(workspaceId, channelId, {
          thread: rootId,
          ...(before === undefined ? {} : { before }),
        });
        all = mergeMessages(all, batch);
        const oldest = batch[0];
        if (!oldest || batch.length < CHAT_PAGE_SIZE) break;
        if (batch.some((m) => m.id === rootId)) break;
        if (page + 1 >= pages && oldest.seq <= floor) break;
        before = oldest.seq;
      }
      return all;
    },
    [workspaceId, channelId, rootId],
  );

  const query = useQuery({
    queryKey: key,
    queryFn: () => {
      // Read back to the oldest row already cached — the root, when the
      // reader paged all the way up — so a refetch never drops it.
      const cached = queryClient.getQueryData<ChatMessageDto[]>(key);
      const reached = cached?.[0]?.seq ?? Infinity;
      return readBack(undefined, THREAD_OPEN_PAGES, reached);
    },
  });

  const [loadingOlder, setLoadingOlder] = useState(false);
  const data = query.data;
  const hasOlder = !!data?.length && !data.some((m) => m.id === rootId);

  /** Read the page of replies before the oldest loaded one. */
  const loadOlder = useCallback(async () => {
    const oldest = data?.[0];
    if (!oldest || !hasOlder || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await readBack(oldest.seq, 1, Infinity);
      queryClient.setQueryData<ChatMessageDto[]>(key, (old) =>
        mergeMessages(old, page),
      );
    } finally {
      setLoadingOlder(false);
    }
  }, [data, hasOlder, loadingOlder, readBack, queryClient, key]);

  return {
    data,
    isLoading: query.isLoading,
    error: query.error,
    /** Try again after the thread failed to load. */
    retry: query.refetch,
    hasOlder,
    loadingOlder,
    loadOlder,
  };
}

function patchEverywhere(
  queryClient: QueryClient,
  message: ChatMessageDto,
): void {
  queryClient.setQueryData<ChatMessageDto[]>(
    chatKeys.messages(message.channelId),
    (old) => replaceMessage(old, message),
  );
  if (message.threadRootId) {
    queryClient.setQueryData<ChatMessageDto[]>(
      chatKeys.thread(message.threadRootId),
      (old) => replaceMessage(old, message),
    );
  }
}

/**
 * Put a message the server accepted where it belongs: the channel log when
 * it is top-level or also sent to the channel, its thread when it is a reply.
 */
function applyPosted(
  queryClient: QueryClient,
  workspaceId: string,
  channelId: string,
  message: ChatMessageDto,
): void {
  if (!message.threadRootId || message.alsoInChannel) {
    queryClient.setQueryData<ChatMessageDto[]>(
      chatKeys.messages(channelId),
      (old) => (old ? mergeMessages(old, [message]) : old),
    );
  }
  if (message.threadRootId) {
    queryClient.setQueryData<ChatMessageDto[]>(
      chatKeys.thread(message.threadRootId),
      (old) => mergeMessages(old, [message]),
    );
    // The root's reply count moved; re-read it from the server rather
    // than incrementing a number the stream may also be correcting.
    const root = queryClient
      .getQueryData<ChatMessageDto[]>(chatKeys.messages(channelId))
      ?.find((m) => m.id === message.threadRootId);
    if (root) {
      void fetchMessages(workspaceId, channelId, { after: root.seq - 1 })
        .then((batch) =>
          queryClient.setQueryData<ChatMessageDto[]>(
            chatKeys.messages(channelId),
            (old) => mergeMessages(old, batch),
          ),
        )
        .catch(() => {});
    }
  }
}

const NO_PENDING: PendingSend[] = [];
/** Each channel's last queued post, per client; see `run` in `useSendMessage`. */
const SEND_QUEUE_WAIT_MS = 15_000;
const sendQueues = new WeakMap<QueryClient, Map<string, Promise<void>>>();

/**
 * The reader's unanswered sends to a channel: those drawn in its log
 * (`threadRootId` null — top-level, or replies also sent to the channel) or
 * in one thread. Held in the query client under `chatKeys.pending`, a key
 * the stream never invalidates, so a reconnect or a thread refetch cannot
 * drop a send still in flight or one that failed — and mirrored to
 * `sessionStorage` (`pendingStore`), so a reload cannot either.
 */
export function usePendingMessages(
  channelId: string,
  threadRootId: string | null,
): ChatLine[] {
  const queryClient = useQueryClient();
  const key = chatKeys.pending(channelId);
  const { data = NO_PENDING } = useQuery({
    queryKey: key,
    queryFn: () => queryClient.getQueryData<PendingSend[]>(key) ?? [],
    // What a reload left behind; `updatePending` keeps the two in step.
    initialData: () =>
      pendingStore.load(queryClient.getQueryData<User>(["me"])?.id, channelId),
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return useMemo(
    () =>
      data
        .filter((p) =>
          threadRootId === null
            ? !p.input.threadRootId || !!p.input.alsoInChannel
            : p.input.threadRootId === threadRootId,
        )
        .map((p) => p.message),
    [data, threadRootId],
  );
}

/**
 * Optimistic send. `send` draws the message at the tail at once (pending),
 * swaps in the server's row when the post succeeds, and leaves it marked
 * failed — with its text, for `retry` — when it does not. The promise it
 * returns settles with the post, for a caller that reports the failure;
 * the row on screen does not depend on anybody awaiting it.
 */
export function useSendMessage(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();

  const run = useCallback(
    (clientId: string, input: PostInput): Promise<ChatMessageDto> => {
      const post = async () => {
        try {
          const message = await postMessage(workspaceId, channelId, {
            ...input,
            clientId,
          });
          // Both writes in one tick, so the server's row and the retired
          // local one land in the same render and never flicker or double.
          applyPosted(queryClient, workspaceId, channelId, message);
          updatePending(queryClient, channelId, (sends) =>
            sends.filter((p) => p.clientId !== clientId),
          );
          return message;
        } catch (err) {
          const failure = classifySendFailure(err);
          updatePending(queryClient, channelId, (sends) =>
            sends.map((p) =>
              p.clientId === clientId
                ? {
                    ...p,
                    state: "failed",
                    message: { ...p.message, localState: "failed", failure },
                  }
                : p,
            ),
          );
          throw err;
        }
      };
      // One post at a time per channel: the composer clears at once, so two
      // quick sends would otherwise race and could land out of order. A post
      // that hangs is waited on only so long, so it cannot hold every later
      // send at "pending" with no Retry.
      let queues = sendQueues.get(queryClient);
      if (!queues) sendQueues.set(queryClient, (queues = new Map()));
      const previous = queues.get(channelId) ?? Promise.resolve();
      const result = Promise.race([
        previous,
        new Promise<void>((r) => setTimeout(r, SEND_QUEUE_WAIT_MS)),
      ]).then(post);
      queues.set(
        channelId,
        result.then(
          () => undefined,
          () => undefined,
        ),
      );
      return result;
    },
    [queryClient, workspaceId, channelId],
  );

  const send = useCallback(
    (input: PostInput): Promise<ChatMessageDto> => {
      // Also the post's idempotency key: a retry, even after a reload,
      // sends it again, and the server answers with the first copy.
      const clientId = newClientId();
      const me = queryClient.getQueryData<User>(["me"]);
      // The newest seq known anywhere: the server's row for this send can
      // only come after it, which is how `withPending` tells the two apart
      // from an earlier message with the same text.
      const known = Math.max(
        0,
        queryClient
          .getQueryData<ChannelSummary[]>(chatKeys.channels(workspaceId))
          ?.find((c) => c.id === channelId)?.lastSeq ?? 0,
        lastSeqOf(
          queryClient.getQueryData<ChatMessageDto[]>(
            chatKeys.messages(channelId),
          ),
        ) ?? 0,
        input.threadRootId
          ? (lastSeqOf(
              queryClient.getQueryData<ChatMessageDto[]>(
                chatKeys.thread(input.threadRootId),
              ),
            ) ?? 0)
          : 0,
      );
      const message: ChatLine = {
        id: `local-${clientId}`,
        channelId,
        seq: known,
        author: me
          ? { id: me.id, username: me.username, photo: me.photo || null }
          : null,
        body: input.body,
        threadRootId: input.threadRootId ?? null,
        alsoInChannel: !!input.alsoInChannel,
        replyCount: 0,
        lastReplyAt: null,
        editedAt: null,
        deleted: false,
        createdAt: new Date().toISOString(),
        localState: "pending",
        clientId,
      };
      updatePending(queryClient, channelId, (sends) => [
        ...sends,
        { clientId, input, state: "pending", message },
      ]);
      return run(clientId, input);
    },
    [queryClient, workspaceId, channelId, run],
  );

  /**
   * Send a failed message again, in place, under its original `clientId`.
   * Null when there is nothing to retry, or the server refused it for good.
   */
  const retry = useCallback(
    (clientId: string): Promise<ChatMessageDto> | null => {
      const entry = (
        queryClient.getQueryData<PendingSend[]>(chatKeys.pending(channelId)) ??
        pendingStore.load(
          queryClient.getQueryData<User>(["me"])?.id,
          channelId,
        )
      ).find((p) => p.clientId === clientId);
      if (!entry || entry.state !== "failed") return null;
      // The server refused this message for good; the row says why.
      if (entry.message.failure?.retryable === false) return null;
      updatePending(queryClient, channelId, (sends) =>
        sends.map((p) =>
          p.clientId === clientId
            ? {
                ...p,
                state: "pending",
                message: {
                  ...p.message,
                  localState: "pending",
                  failure: undefined,
                },
              }
            : p,
        ),
      );
      return run(clientId, entry.input);
    },
    [queryClient, channelId, run],
  );

  /** Drop a failed message without sending it. */
  const discard = useCallback(
    (clientId: string) => {
      updatePending(queryClient, channelId, (sends) =>
        sends.filter((p) => p.clientId !== clientId),
      );
    },
    [queryClient, channelId],
  );

  return useMemo(() => ({ send, retry, discard }), [send, retry, discard]);
}

export function useEditMessage(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; body: string }) =>
      editMessage(workspaceId, input.messageId, input.body),
    onSuccess: (message) => patchEverywhere(queryClient, message),
  });
}

export function useDeleteMessage(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (message: ChatMessageDto) => {
      await deleteMessage(workspaceId, message.id);
      return message;
    },
    // A delete keeps the row (a thread root's replies stay reachable) and
    // blanks its body, as the server does.
    onSuccess: (message) =>
      patchEverywhere(queryClient, { ...message, deleted: true, body: "" }),
  });
}

/**
 * Advance the read position to `seq`, at most once per new high-water mark,
 * and clear the channel's counts in the list right away.
 */
export function useMarkRead(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  const sent = useRef(0);
  useEffect(() => {
    sent.current = 0;
  }, [channelId]);

  return useCallback(
    (seq: number) => {
      if (seq <= sent.current) return;
      sent.current = seq;
      queryClient.setQueryData<ChannelSummary[]>(
        chatKeys.channels(workspaceId),
        (old) => (old ? markChannelRead(old, channelId, seq) : old),
      );
      markRead(workspaceId, channelId, seq).catch((err) => {
        // Let the next visible message try again.
        sent.current = 0;
        console.warn("[chat] mark read failed", err);
      });
    },
    [queryClient, workspaceId, channelId],
  );
}

function useInvalidateChannels(workspaceId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: chatKeys.channels(workspaceId) });
}

export function useCreateChannel(workspaceId: string) {
  const invalidate = useInvalidateChannels(workspaceId);
  return useMutation({
    mutationFn: (input: {
      kind: "public" | "private";
      name: string;
      topic?: string;
    }) => createChannel(workspaceId, input),
    onSuccess: () => invalidate(),
  });
}

export function useOpenDm(workspaceId: string) {
  const invalidate = useInvalidateChannels(workspaceId);
  return useMutation({
    mutationFn: (userIds: number[]) => openDm(workspaceId, userIds),
    onSuccess: () => invalidate(),
  });
}

export function useJoinChannel(workspaceId: string) {
  const invalidate = useInvalidateChannels(workspaceId);
  return useMutation({
    mutationFn: (channelId: string) => joinChannel(workspaceId, channelId),
    onSuccess: () => invalidate(),
  });
}

/** Who is in a public or private channel; fetched only while `enabled`. */
export function useChannelMembers(
  workspaceId: string,
  channelId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: chatKeys.members(channelId),
    queryFn: () => fetchChannelMembers(workspaceId, channelId),
    enabled,
  });
}

export function useInviteToChannel(workspaceId: string) {
  const invalidate = useInvalidateChannels(workspaceId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { channelId: string; userIds: number[] }) =>
      inviteToChannel(workspaceId, input.channelId, input.userIds),
    onSuccess: (_, input) => {
      invalidate();
      void queryClient.invalidateQueries({
        queryKey: chatKeys.members(input.channelId),
      });
    },
  });
}

export function useLeaveChannel(workspaceId: string) {
  const invalidate = useInvalidateChannels(workspaceId);
  return useMutation({
    mutationFn: (channelId: string) => leaveChannel(workspaceId, channelId),
    onSuccess: () => invalidate(),
  });
}

/** Remove somebody else from a channel; refreshes its member list. */
export function useRemoveChannelMember(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { channelId: string; userId: number }) =>
      removeChannelMember(workspaceId, input.channelId, input.userId),
    onSuccess: (_, input) =>
      queryClient.invalidateQueries({
        queryKey: chatKeys.members(input.channelId),
      }),
  });
}

export function useUpdateChannel(workspaceId: string) {
  const invalidate = useInvalidateChannels(workspaceId);
  return useMutation({
    mutationFn: (input: {
      channelId: string;
      name?: string;
      topic?: string;
      archived?: boolean;
    }) => {
      const { channelId, ...patch } = input;
      return updateChannel(workspaceId, channelId, patch);
    },
    onSuccess: () => invalidate(),
  });
}
