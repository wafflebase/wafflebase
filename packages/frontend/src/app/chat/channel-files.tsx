import { useState } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { IconFiles } from "@tabler/icons-react";

import { fetchChannelFiles, type ChatFileDto } from "@/api/chat";
import { userFacingError } from "@/api/http-error";
import { typeMeta } from "@/app/documents/document-type-meta";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { anchorLabel, buildDocumentPath } from "@/components/chat/document-link";
import { cn } from "@/lib/utils";

const PAGE = 50;

const SHARED_AT = new Intl.DateTimeFormat([], {
  month: "short",
  day: "numeric",
});

/**
 * The Files query. Keyed on the channel's `lastSeq` as well, so a new
 * message (which may carry a card) refetches it without this view having to
 * watch the message cache; an edit that adds a card shows on the next open,
 * which refetches.
 */
function useChannelFiles(
  workspaceId: string,
  channelId: string,
  lastSeq: number,
) {
  return useInfiniteQuery({
    queryKey: ["chat", channelId, "files", lastSeq],
    queryFn: ({ pageParam }) =>
      fetchChannelFiles(workspaceId, channelId, {
        limit: PAGE,
        before: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.cursor,
    placeholderData: (previous) => previous,
  });
}

interface ChannelFilesButtonProps {
  workspaceId: string;
  channelId: string;
  lastSeq: number;
}

/**
 * The channel header's Files: every document a message here links to, once,
 * newest share first (`docs/design/chat.md` § Surfaces). Each row opens the
 * document with the chat panel on this channel.
 */
export function ChannelFilesButton({
  workspaceId,
  channelId,
  lastSeq,
}: ChannelFilesButtonProps) {
  const [open, setOpen] = useState(false);
  const files = useChannelFiles(workspaceId, channelId, lastSeq);
  const rows = files.data?.pages.flatMap((p) => p.files) ?? [];
  const more = files.hasNextPage;
  const count =
    files.data === undefined ? undefined : `${rows.length}${more ? "+" : ""}`;
  const label =
    count === undefined
      ? "Files"
      : `${count} ${rows.length === 1 && !more ? "file" : "files"}`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void files.refetch();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1 px-2 text-muted-foreground tabular-nums pointer-coarse:min-h-11"
          aria-label={label}
        >
          <IconFiles />
          <span className="hidden md:inline">Files</span>
          {count !== undefined && <span>{count}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
        aria-label="Files shared in this channel"
      >
        <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          Files
        </p>
        {files.isError && rows.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-3 py-3 text-sm">
            <p>{userFacingError(files.error, "Couldn't load the files.")}</p>
            <Button size="sm" variant="outline" onClick={() => files.refetch()}>
              Retry
            </Button>
          </div>
        ) : files.data === undefined ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            No documents shared yet. Paste a document link in a message and it
            shows up here.
          </p>
        ) : (
          <ul className="py-1">
            {rows.map((file) => (
              <li key={file.documentId}>
                <FileRow
                  file={file}
                  channelId={channelId}
                  onOpen={() => setOpen(false)}
                />
              </li>
            ))}
          </ul>
        )}
        {more && (
          <div className="border-t px-3 py-2">
            <Button
              size="sm"
              variant="ghost"
              className="w-full"
              disabled={files.isFetchingNextPage}
              onClick={() => files.fetchNextPage()}
            >
              {files.isFetchingNextPage ? "Loading…" : "Show more"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FileRow({
  file,
  channelId,
  onOpen,
}: {
  file: ChatFileDto;
  channelId: string;
  onOpen: () => void;
}) {
  const { Icon, color } = typeMeta(file.type);
  const label = anchorLabel(file.anchor);
  const who = file.sharedBy?.username ?? "Deleted user";
  return (
    <Link
      to={buildDocumentPath(
        { id: file.documentId, type: file.type },
        { chat: channelId, at: file.anchor },
      )}
      onClick={onOpen}
      className="flex items-start gap-2 px-3 py-2 text-sm outline-none hover:bg-muted focus-visible:bg-muted pointer-coarse:min-h-11"
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", color)} aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{file.title}</span>
        {label && (
          <span className="truncate text-xs text-muted-foreground">{label}</span>
        )}
        <span className="truncate text-xs text-muted-foreground">
          {who} ·{" "}
          <time dateTime={file.sharedAt}>
            {SHARED_AT.format(new Date(file.sharedAt))}
          </time>
        </span>
      </span>
    </Link>
  );
}
