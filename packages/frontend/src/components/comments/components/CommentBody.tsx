import { Fragment } from "react";

import { parseMentionBody } from "../mentions.ts";

type Props = {
  body: string;
};

/**
 * Render a comment body, turning inline `@[username](userId)` tokens into
 * mention chips while leaving the surrounding text intact (whitespace and
 * newlines preserved via `whitespace-pre-wrap`). Parse-only: it needs no
 * member list, so existing mentions render even for anonymous viewers.
 *
 * The chip's `title` shows the username; click is a no-op for now, leaving
 * room for a profile/jump action when mention notifications land.
 */
export function CommentBody({ body }: Props) {
  const segments = parseMentionBody(body);
  return (
    <p className="whitespace-pre-wrap text-xs text-foreground">
      {segments.map((segment, i) =>
        segment.type === "text" ? (
          <Fragment key={i}>{segment.value}</Fragment>
        ) : (
          <span
            key={i}
            data-mention-user-id={segment.userId}
            title={segment.username}
            className="rounded-sm bg-primary/10 px-0.5 font-medium text-primary"
          >
            @{segment.username}
          </span>
        ),
      )}
    </p>
  );
}
