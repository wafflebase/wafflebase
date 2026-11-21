import { Fragment, type ReactNode } from "react";
import { parseMentionBody } from "@/components/comments/mentions";

// A bare http(s) URL. Trailing sentence punctuation is trimmed off below, so
// "see https://x.test/a." links `https://x.test/a`, not the period.
const URL_RE = /https?:\/\/[^\s<>"]+/g;
const TRAILING_PUNCTUATION = /[.,!?;:'")\]]+$/;

function linkify(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trailing = TRAILING_PUNCTUATION.exec(url)?.[0] ?? "";
    if (trailing) url = url.slice(0, -trailing.length);
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <a
        key={`${keyPrefix}-${start}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-link underline-offset-2 break-all hover:underline"
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * A chat message body: plain text with line breaks kept, `@[username](id)`
 * tokens as mention chips (the comment body's treatment), and bare URLs as
 * links. Everything renders as text nodes; nothing in a body becomes markup.
 */
export function MessageBody({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm text-foreground">
      {parseMentionBody(body).map((segment, i) =>
        segment.type === "text" ? (
          <Fragment key={i}>{linkify(segment.value, String(i))}</Fragment>
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
