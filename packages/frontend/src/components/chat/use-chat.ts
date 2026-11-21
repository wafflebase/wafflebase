import { useCallback, useEffect, useRef, useState } from "react";
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
  editMessage,
  fetchChannels,
  fetchMessages,
  inviteToChannel,
  joinChannel,
  leaveChannel,
  markRead,
  openDm,
  postMessage,
  updateChannel,
  type ChannelSummary,
  type ChatMessageDto,
} from "@/api/chat";
import {
  chatKeys,
  lastSeqOf,
  markChannelRead,
  mergeMessages,
  replaceMessage,
} from "./chat-cache";
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
/** A thread holds at most this many pages of replies in P1. */
const MAX_THREAD_PAGES = 10;

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

  const loadOlder = useCallback(async () => {
    const oldest = query.data?.[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(workspaceId, channelId, {
        before: oldest.seq,
      });
      if (page.length < CHAT_PAGE_SIZE) {
        exhausted.add(channelId);
        setHasOlder(false);
      }
      queryClient.setQueryData<ChatMessageDto[]>(
        chatKeys.messages(channelId),
        (old) => mergeMessages(old, page),
      );
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
  };
}

/** A thread's replies, ascending. */
export function useThreadMessages(
  workspaceId: string,
  channelId: string,
  rootId: string,
) {
  return useQuery({
    queryKey: chatKeys.thread(rootId),
    queryFn: async () => {
      let all: ChatMessageDto[] = [];
      // Page forward from the start: without a cursor the server returns
      // the newest page, after which nothing is newer and the loop stops.
      let after = 0;
      for (let page = 0; page < MAX_THREAD_PAGES; page++) {
        const batch = await fetchMessages(workspaceId, channelId, {
          thread: rootId,
          after,
        });
        all = mergeMessages(all, batch);
        if (batch.length < CHAT_PAGE_SIZE) break;
        const last = lastSeqOf(batch);
        if (last === null) break;
        after = last;
      }
      return all;
    },
  });
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

/** Post to a channel or, with `threadRootId`, to a thread. */
export function usePostMessage(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      body: string;
      threadRootId?: string;
      alsoInChannel?: boolean;
    }) => postMessage(workspaceId, channelId, input),
    onSuccess: (message) => {
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
    },
  });
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
        (old) => (old ? markChannelRead(old, channelId) : old),
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

export function useInviteToChannel(workspaceId: string) {
  const invalidate = useInvalidateChannels(workspaceId);
  return useMutation({
    mutationFn: (input: { channelId: string; userIds: number[] }) =>
      inviteToChannel(workspaceId, input.channelId, input.userIds),
    onSuccess: () => invalidate(),
  });
}

export function useLeaveChannel(workspaceId: string) {
  const invalidate = useInvalidateChannels(workspaceId);
  return useMutation({
    mutationFn: (channelId: string) => leaveChannel(workspaceId, channelId),
    onSuccess: () => invalidate(),
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
