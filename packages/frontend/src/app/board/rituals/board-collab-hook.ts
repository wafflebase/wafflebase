import { createContext, useContext, type MutableRefObject } from "react";

import type { BoardAnchor, CommentAuthor, Thread } from "@/types/comments";
import type { MentionMember } from "@/components/comments/components/CommentComposer";
import type { RitualTool } from "./ritual-tool";

/** Who is acting: the stamp/ballot key and the comment author. */
export interface BoardCollabUser {
  /** Stable per-user key for stamps and ballots (`u<userId>`). */
  key: string;
  name: string;
  author: CommentAuthor;
}

/** A comment being written: where its pin goes and where to float the composer. */
export interface PendingBoardComment {
  anchor: BoardAnchor;
  /** Screen point (relative to the canvas host) the composer opens beside. */
  screen: { x: number; y: number };
}

export interface BoardCollabValue {
  documentId: string;
  readOnly: boolean;
  user: BoardCollabUser | null;
  members: MentionMember[];
  /** The stamp / comment tool, shared by the toolbar and the canvas. */
  tool: RitualTool;
  threads: Thread<BoardAnchor>[];
  /** Ids of the board's top-level elements, for orphan labels. */
  liveIds: ReadonlySet<string>;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  pending: PendingBoardComment | null;
  setPending: (pending: PendingBoardComment | null) => void;
  addThread: (anchor: BoardAnchor, body: string) => Promise<string | null>;
  addReply: (threadId: string, body: string) => Promise<void>;
  setResolved: (threadId: string, resolved: boolean) => Promise<void>;
  editComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  deleteComment: (threadId: string, commentId: string) => Promise<void>;
  /**
   * Pan the canvas to an anchor. Filled by the canvas layer
   * (`BoardRituals`) — the provider sits above the canvas and owns no
   * viewport.
   */
  focusAnchorRef: MutableRefObject<((anchor: BoardAnchor) => void) | null>;
  /** Open the panel on a thread and pan to its pin. */
  openThread: (thread: Thread<BoardAnchor>) => void;
}

export const BoardCollabContext = createContext<BoardCollabValue | null>(null);

/**
 * The board's collaboration rituals, or `null` outside a
 * `BoardCollabProvider` — the shared-link route mounts none, and there the
 * canvas still paints stamps and results but offers no tools.
 */
export function useBoardCollab(): BoardCollabValue | null {
  return useContext(BoardCollabContext);
}

