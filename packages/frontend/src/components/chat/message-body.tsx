import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Link,
  useInRouterContext,
  useNavigate,
} from "react-router-dom";
import {
  DOCUMENT_PATH_SOURCE,
  DOCUMENT_ROUTE_LETTERS,
} from "@wafflebase/core/document-link";
import type { ChatDocumentRefDto } from "@/api/chat";
import { typeMeta } from "@/app/documents/document-type-meta";
import { parseMentionBody } from "@/components/comments/mentions";
import { cn } from "@/lib/utils";
import {
  anchorLabel,
  buildDocumentPath,
  decodeAnchor,
  parseDocumentLink,
  routerBasename,
} from "./document-link";

// A bare http(s) URL, or a root-relative document path standing on its own
// (`/s/<id>`), which the server also reads as a card — by the same grammar,
// `@wafflebase/core/document-link`. Trailing sentence punctuation is trimmed
// off below, so "see https://x.test/a." links `https://x.test/a`, not the
// period.
const URL_RE = new RegExp(
  `https?://[^\\s<>"]+|(?<=^|[\\s(<])${DOCUMENT_PATH_SOURCE}(?![0-9A-Za-z-])(?:[?#][^\\s<>"]*)?`,
  "g",
);
const TRAILING_PUNCTUATION = /[.,!?;:'")\]]+$/;

/** Bodies collapse past this many lines behind "Show more". */
const COLLAPSED_LINES = 12;
/**
 * Below both of these a body cannot reach the clamp at any width the log is
 * drawn at, so it is not measured: most messages are one line, and a
 * ResizeObserver per line of a long log is work for nothing.
 */
const MEASURE_MIN_CHARS = 240;

const LINK_CLASS = "text-link underline-offset-2 break-all hover:underline";

/**
 * The app's own pages: a workspace, a document of any type, a share or
 * template link. The origin also serves things the router has no route for —
 * the docs site under `/docs`, the API, images — so a same-origin link is
 * routed in place only when its path (after the basename) is one of these.
 */
const IN_APP_PATH = new RegExp(
  `^/(?:(?:w|${DOCUMENT_ROUTE_LETTERS.join("|")}|shared|t|invite)/|(?:documents|templates|settings)(?:[/?#]|$))`,
);

/** Whether `url` is this app's own origin, and so opens in this tab. */
function isSameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * A link to a page of this app: the router navigates to it in place, as a
 * link in the sidebar would, instead of opening a second copy of the app.
 * Modified clicks (a new tab on purpose) are left to the browser.
 */
function InAppLink({
  url,
  tabIndex,
}: {
  url: string;
  tabIndex?: number;
}) {
  const navigate = useNavigate();
  // The router's basename, so `/app/w/1/chat` navigates to `/w/1/chat`.
  const base = routerBasename();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const target = new URL(url);
    if (base && !target.pathname.startsWith(base)) return;
    const path = target.pathname.slice(base.length) || "/";
    // Anything else on this origin is a plain same-tab page load.
    if (!IN_APP_PATH.test(path)) return;
    e.preventDefault();
    navigate(`${path}${target.search}${target.hash}`);
  };
  return (
    <a href={url} onClick={onClick} tabIndex={tabIndex} className={LINK_CLASS}>
      {url}
    </a>
  );
}

function BodyLink({ url, tabIndex }: { url: string; tabIndex?: number }) {
  const routed = useInRouterContext();
  if (isSameOrigin(url)) {
    return routed ? (
      <InAppLink url={url} tabIndex={tabIndex} />
    ) : (
      <a href={url} tabIndex={tabIndex} className={LINK_CLASS}>
        {url}
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={tabIndex}
      className={LINK_CLASS}
    >
      {url}
    </a>
  );
}

/**
 * A link the server resolved to a document of this workspace: type icon in
 * its hue, title, and the anchor's label. It opens the document in place
 * with the chat panel on `channelId`, at the anchor the server validated and
 * stored — the one the label describes — never the body's raw `?at=`, which
 * the sender is free to make say something else. The raw URL stays
 * reachable as the tooltip.
 */
function DocumentCard({
  url,
  docRef,
  channelId,
  tabIndex,
}: {
  url: string;
  docRef: ChatDocumentRefDto;
  channelId?: string;
  tabIndex?: number;
}) {
  const routed = useInRouterContext();
  const { Icon, color } = typeMeta(docRef.type);
  const label = anchorLabel(docRef.anchor);
  const path = buildDocumentPath(
    { id: docRef.documentId, type: docRef.type },
    { chat: channelId, at: docRef.anchor },
  );
  const className =
    "my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 align-middle text-sm text-foreground no-underline outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50";
  const content = (
    <>
      <Icon className={cn("size-4 shrink-0", color)} aria-hidden="true" />
      <span className="min-w-0 truncate font-medium">{docRef.title}</span>
      {label && (
        <span className="min-w-0 truncate text-muted-foreground">
          <span aria-hidden="true">· </span>
          {label}
        </span>
      )}
    </>
  );
  return routed ? (
    <Link
      to={path}
      title={url}
      tabIndex={tabIndex}
      data-document-card={docRef.documentId}
      className={className}
    >
      {content}
    </Link>
  ) : (
    <a
      href={url}
      title={url}
      tabIndex={tabIndex}
      data-document-card={docRef.documentId}
      className={className}
    >
      {content}
    </a>
  );
}

interface LinkContext {
  tabIndex: number | undefined;
  refs: ReadonlyMap<string, ChatDocumentRefDto>;
  channelId?: string;
  /** Per document, which of its links (in body order) renders as the card. */
  cardAt: ReadonlyMap<string, number>;
  /** Per document, how many of its links have been rendered so far. */
  seen: Map<string, number>;
}

/** The links in `text`, trailing sentence punctuation trimmed off. */
function* bodyLinks(text: string): Generator<{ start: number; url: string }> {
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0];
    const trailing = TRAILING_PUNCTUATION.exec(url)?.[0] ?? "";
    if (trailing) url = url.slice(0, -trailing.length);
    yield { start: match.index ?? 0, url };
  }
}

/** Key-order-insensitive JSON, since a stored anchor comes back from jsonb. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Which link to each referenced document is its card. The server keeps one
 * ref per document, so a body that links one document twice has a single
 * stored anchor; carding every link would label — and send — the second to
 * the first's place. The card goes on the first link whose own `?at=`
 * decodes to the stored anchor, else (the stored one matching none) on the
 * first link; the rest stay plain links to where they say.
 */
function pickCards(
  texts: string[],
  refs: ReadonlyMap<string, ChatDocumentRefDto>,
): Map<string, number> {
  const counts = new Map<string, number>();
  const matched = new Map<string, number>();
  for (const text of texts) {
    for (const { url } of bodyLinks(text)) {
      const doc = parseDocumentLink(url);
      const docRef = doc ? refs.get(doc.documentId) : undefined;
      if (!doc || !docRef) continue;
      const index = counts.get(doc.documentId) ?? 0;
      counts.set(doc.documentId, index + 1);
      if (
        !matched.has(doc.documentId) &&
        canonical(decodeAnchor(doc.at, docRef.type)) === canonical(docRef.anchor)
      ) {
        matched.set(doc.documentId, index);
      }
    }
  }
  return new Map([...counts.keys()].map((id) => [id, matched.get(id) ?? 0]));
}

function linkify(
  text: string,
  keyPrefix: string,
  ctx: LinkContext,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const { start, url } of bodyLinks(text)) {
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${start}`;
    const doc = parseDocumentLink(url);
    const docRef = doc ? ctx.refs.get(doc.documentId) : undefined;
    let isCard = false;
    if (doc && docRef) {
      const index = ctx.seen.get(doc.documentId) ?? 0;
      ctx.seen.set(doc.documentId, index + 1);
      isCard = ctx.cardAt.get(doc.documentId) === index;
    }
    if (isCard && docRef) {
      out.push(
        <DocumentCard
          key={key}
          url={url}
          docRef={docRef}
          channelId={ctx.channelId}
          tabIndex={ctx.tabIndex}
        />,
      );
    } else if (url.startsWith("/")) {
      // A bare path names no document here, or is a second link to a
      // carded one: it stays text.
      out.push(url);
    } else {
      out.push(<BodyLink key={key} url={url} tabIndex={ctx.tabIndex} />);
    }
    last = start + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface MessageBodyProps {
  body: string;
  /** The reader: a mention of them is marked as theirs. */
  me?: number;
  /**
   * False keeps the body's links out of the tab order — the log is one tab
   * stop, and only the message it rests on is tabbable inside.
   */
  tabbable?: boolean;
  /** The message's document refs: a link naming one renders as a card. */
  refs?: ChatDocumentRefDto[];
  /** The channel a card's document should open its chat panel on. */
  channelId?: string;
}

/**
 * A chat message body: plain text with line breaks kept, `@[username](id)`
 * tokens as mention chips, and bare URLs as links — this app's own open in
 * place, others in a new tab. A link the server resolved to a document of
 * this workspace (`refs`) renders as a document card. Everything renders as
 * text nodes; nothing in a body becomes markup.
 *
 * A mention is a neutral chip, and the reader's own is the butter selected
 * wash: syrup already marks the "New messages" divider, the unread badges
 * and Send. A body past twelve lines collapses behind "Show more".
 */
export function MessageBody({
  body,
  me,
  tabbable = true,
  refs,
  channelId,
}: MessageBodyProps) {
  const tabIndex = tabbable ? undefined : -1;
  const segments = parseMentionBody(body);
  const refMap = new Map((refs ?? []).map((r) => [r.documentId, r]));
  const linkContext: LinkContext = {
    tabIndex,
    refs: refMap,
    channelId,
    cardAt: pickCards(
      segments.flatMap((s) => (s.type === "text" ? [s.value] : [])),
      refMap,
    ),
    seen: new Map(),
  };
  // Tokens carry the id as text.
  const self = me === undefined ? null : String(me);
  const ref = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const measured =
    body.length >= MEASURE_MIN_CHARS ||
    body.split("\n").length > COLLAPSED_LINES;

  // Measured while clamped: a clamped box whose content is taller than it
  // is cut off. Re-measured as the column's width changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !measured || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [body, measured, expanded]);

  return (
    <>
      <p
        ref={ref}
        className={cn(
          "whitespace-pre-wrap break-words text-sm text-foreground",
          measured && !expanded && "line-clamp-12",
        )}
      >
        {segments.map((segment, i) =>
          segment.type === "text" ? (
            <Fragment key={i}>
              {linkify(segment.value, String(i), linkContext)}
            </Fragment>
          ) : (
            <span
              key={i}
              data-mention-user-id={segment.userId}
              data-mention-self={segment.userId === self || undefined}
              title={segment.username}
              className={cn(
                "rounded-sm px-0.5 font-medium",
                segment.userId === self
                  ? "bg-selected text-selected-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              @{segment.username}
            </span>
          ),
        )}
      </p>
      {measured && (overflows || expanded) && (
        <button
          type="button"
          tabIndex={tabIndex}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 basis-full rounded-sm text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}
