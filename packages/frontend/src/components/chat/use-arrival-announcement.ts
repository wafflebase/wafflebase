import { useEffect, useRef, useState } from "react";
import type { ChatMessageDto } from "@/api/chat";
import { mentionBodyToPlainText } from "@/components/comments/mentions";

/** Longest message text read out; the rest is in the log. */
const MAX_SPOKEN_CHARS = 140;
/** At most this many arrivals in one announcement. */
const MAX_SPOKEN_MESSAGES = 3;

function spoken(m: ChatMessageDto): string {
  const text = mentionBodyToPlainText(m.body).replace(/\s+/g, " ").trim();
  const clipped =
    text.length > MAX_SPOKEN_CHARS
      ? `${text.slice(0, MAX_SPOKEN_CHARS - 1)}…`
      : text;
  return `${m.author?.username ?? "Deleted user"}: ${clipped}`;
}

/**
 * What a polite live region should say as messages arrive: only messages
 * from others that land past the newest one already shown. The first load,
 * "Load older" (which grows the head) and a reconnect that re-reads the loaded
 * range (which replaces rows in place) say nothing — the log they change is
 * not a live region, so none of it is read out.
 *
 * `include` narrows what counts (the channel log leaves out thread replies
 * not sent to it). Returns the text to put in the region.
 */
export function useArrivalAnnouncement(
  messages: ChatMessageDto[],
  me: number,
  ready: boolean,
  include: (m: ChatMessageDto) => boolean = () => true,
): string {
  const [text, setText] = useState("");
  const tail = useRef<number | null>(null);
  const newest = messages.at(-1)?.seq;

  useEffect(() => {
    if (!ready || newest === undefined) return;
    const prev = tail.current;
    tail.current = Math.max(prev ?? newest, newest);
    if (prev === null || newest <= prev) return;
    const arrived = messages.filter(
      (m) =>
        m.seq > prev &&
        !m.deleted &&
        m.author?.id !== me &&
        include(m),
    );
    if (arrived.length === 0) return;
    setText(arrived.slice(-MAX_SPOKEN_MESSAGES).map(spoken).join(". "));
    // `include` is a filter the caller may rebuild each render; the tail
    // moving is what announces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest, ready, me]);

  return text;
}
