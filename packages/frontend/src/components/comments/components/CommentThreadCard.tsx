import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";
import type {
  Comment,
  CommentAnchor,
  CommentAuthor,
  Thread,
} from "@/types/comments";

import { CommentComposer } from "./CommentComposer";

type Props<A extends CommentAnchor> = {
  thread: Thread<A>;
  currentUserId?: string;
  /** When true, all mutation controls are hidden. */
  readOnly?: boolean;
  onReply: (body: string) => Promise<void> | void;
  onResolveToggle: () => Promise<void> | void;
  onEdit: (commentId: string, body: string) => Promise<void> | void;
  onDelete: (commentId: string) => Promise<void> | void;
};

/**
 * Render one thread: root comment, replies, action buttons, reply
 * composer. Used inside the popover and the side panel. Anchor-agnostic.
 */
export function CommentThreadCard<A extends CommentAnchor>({
  thread,
  currentUserId,
  readOnly = false,
  onReply,
  onResolveToggle,
  onEdit,
  onDelete,
}: Props<A>) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {thread.comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            currentUserId={currentUserId}
            readOnly={readOnly}
            onEdit={(body) => onEdit(c.id, body)}
            onDelete={() => onDelete(c.id)}
          />
        ))}
      </ul>

      {!readOnly && currentUserId && (
        <div className="border-t pt-3">
          <CommentComposer
            submitLabel="Reply"
            onSubmit={onReply}
            compact
          />
        </div>
      )}

      {!readOnly && currentUserId && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              void onResolveToggle();
            }}
          >
            {thread.resolved ? "Reopen" : "Resolve"}
          </Button>
        </div>
      )}
    </div>
  );
}

type ItemProps = {
  comment: Comment;
  currentUserId?: string;
  readOnly: boolean;
  onEdit: (body: string) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
};

function CommentItem({
  comment,
  currentUserId,
  readOnly,
  onEdit,
  onDelete,
}: ItemProps) {
  const [editing, setEditing] = useState(false);
  const canMutate = !readOnly && comment.author.userId === currentUserId;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <AuthorAvatar author={comment.author} />
        <strong className="text-xs font-medium">
          {comment.author.username}
        </strong>
        <time className="text-xs text-muted-foreground">
          {formatRelativeTime(comment.createdAt)}
          {comment.editedAt && comment.editedAt > comment.createdAt
            ? " (edited)"
            : ""}
        </time>
      </div>
      {editing ? (
        <CommentComposer
          initialBody={comment.body}
          submitLabel="Save"
          autoFocus
          compact
          onSubmit={async (body) => {
            await onEdit(body);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="whitespace-pre-wrap text-xs text-foreground">
          {comment.body}
        </p>
      )}
      {canMutate && !editing && (
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1 text-[10px] text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1 text-[10px] text-muted-foreground"
            onClick={() => {
              void onDelete();
            }}
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

function AuthorAvatar({ author }: { author: CommentAuthor }) {
  return (
    <Avatar className="h-4 w-4 shrink-0">
      {author.photo && (
        <AvatarImage src={author.photo} alt={author.username} />
      )}
      <AvatarFallback className="text-[8px]">
        {author.username.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
