import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DocumentProvider, useDocument } from '@yorkie-js/react';
import { IconMessage, IconMessagePlus } from '@tabler/icons-react';

import { Toggle } from '@/components/ui/toggle.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx';
import { PdfViewer } from './pdf-viewer.tsx';
import { PdfCommentLayer } from './pdf-comment-layer.tsx';
import { PdfCommentStore } from './comments/pdf-comment-store.ts';
import { usePdfComments } from './comments/pdf-comments-controller.ts';
import { CommentSidePanel } from '@/components/comments/components/CommentSidePanel.tsx';
import { CommentComposer } from '@/components/comments/components/CommentComposer.tsx';
import { CommentThreadCard } from '@/components/comments/components/CommentThreadCard.tsx';
import { initialPdfRoot, type YorkiePdfRoot } from '@/types/pdf-document.ts';
import type { PdfPresence } from '@/types/users.ts';
import type {
  CommentAuthor,
  PdfRect,
  Thread,
  PdfRegionAnchor,
} from '@/types/comments.ts';
import { pdfFileUrl } from '@/api/files.ts';

export type PdfPresenceUser = {
  username: string;
  email: string;
  photo: string;
  userId: string;
};

/**
 * Shared PDF collaboration state (comment threads, side-panel/pin UI, and
 * active-page presence). Held in context so the top-bar controls
 * (`PdfHeaderActions`) and the document body (`PdfCollabBody`) — which the
 * owner and shared routes place in different chrome — read the same state.
 */
type PdfCollabContextValue = {
  readOnly: boolean;
  fileUrl: string;
  threads: Thread<PdfRegionAnchor>[];
  panelOpen: boolean;
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  creating: boolean;
  setCreating: React.Dispatch<React.SetStateAction<boolean>>;
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  activeThread: Thread<PdfRegionAnchor> | null;
  pending: { pageIndex: number; rect: PdfRect } | null;
  setPending: React.Dispatch<
    React.SetStateAction<{ pageIndex: number; rect: PdfRect } | null>
  >;
  author: CommentAuthor;
  store: PdfCommentStore | null;
  addThread: ReturnType<typeof usePdfComments>['addThread'];
  addReply: ReturnType<typeof usePdfComments>['addReply'];
  setResolved: ReturnType<typeof usePdfComments>['setResolved'];
  onActivePageChange: (pageIndex: number) => void;
  closeThreadDetail: () => void;
};

const PdfCollabContext = createContext<PdfCollabContextValue | null>(null);

function usePdfCollab(): PdfCollabContextValue {
  const ctx = useContext(PdfCollabContext);
  if (!ctx) {
    throw new Error('usePdfCollab must be used within a PdfCollabStateProvider');
  }
  return ctx;
}

/**
 * Builds the collaboration state from the Yorkie document and exposes it via
 * context. Renders directly under `useDocument()` (no `DocumentProvider` of
 * its own) so tests can mount it with a mocked document. Routes reach it
 * through `PdfCollabProvider`.
 */
export function PdfCollabStateProvider({
  documentId,
  readOnly,
  token,
  presenceUser,
  children,
}: {
  documentId: string;
  readOnly: boolean;
  token?: string;
  presenceUser: PdfPresenceUser;
  children: ReactNode;
}) {
  const { doc } = useDocument<YorkiePdfRoot, PdfPresence>();
  const store = useMemo(() => (doc ? new PdfCommentStore(doc) : null), [doc]);
  useEffect(() => () => store?.dispose(), [store]);

  const { threads, addThread, addReply, setResolved } = usePdfComments(store);
  const [panelOpen, setPanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    pageIndex: number;
    rect: PdfRect;
  } | null>(null);

  const author: CommentAuthor = {
    userId: presenceUser.userId,
    username: presenceUser.username,
    photo: presenceUser.photo || undefined,
  };

  // Broadcast the active page (deduped) for presence.
  const lastPageRef = useRef<number>(-1);
  const onActivePageChange = (pageIndex: number) => {
    if (!doc || pageIndex === lastPageRef.current) return;
    lastPageRef.current = pageIndex;
    doc.update((_r, p) => p.set({ activePage: pageIndex }));
  };

  const activeThread = activeThreadId
    ? (threads.find((t) => t.id === activeThreadId) ?? null)
    : null;
  const closeThreadDetail = () => setActiveThreadId(null);

  const value: PdfCollabContextValue = {
    readOnly,
    fileUrl: pdfFileUrl(documentId, token),
    threads,
    panelOpen,
    setPanelOpen,
    creating,
    setCreating,
    activeThreadId,
    setActiveThreadId,
    activeThread,
    pending,
    setPending,
    author,
    store,
    addThread,
    addReply,
    setResolved,
    onActivePageChange,
    closeThreadDetail,
  };

  return (
    <PdfCollabContext.Provider value={value}>
      {children}
    </PdfCollabContext.Provider>
  );
}

/**
 * Mounts the `pdf-<id>` Yorkie document (comments + presence only; the PDF
 * bytes stay in the blob) and the shared collaboration state. The ambient
 * `YorkieProvider` is supplied by the route: `PrivateRoute` for the owner
 * route, an explicit public-key provider for the shared route.
 */
export function PdfCollabProvider({
  documentId,
  readOnly,
  token,
  presenceUser,
  children,
}: {
  documentId: string;
  readOnly: boolean;
  token?: string;
  presenceUser: PdfPresenceUser;
  children: ReactNode;
}) {
  const presence: PdfPresence = {
    username: presenceUser.username,
    email: presenceUser.email,
    photo: presenceUser.photo,
  };
  return (
    <DocumentProvider<YorkiePdfRoot, PdfPresence>
      docKey={`pdf-${documentId}`}
      initialRoot={initialPdfRoot()}
      initialPresence={presence}
      enableDevtools={import.meta.env.DEV}
    >
      <PdfCollabStateProvider
        documentId={documentId}
        readOnly={readOnly}
        token={token}
        presenceUser={presenceUser}
      >
        {children}
      </PdfCollabStateProvider>
    </DocumentProvider>
  );
}

/**
 * Top-bar controls (region-comment tool + comments panel toggle), placed in
 * the route's header alongside `ShareDialog`/`UserPresence` — matching the
 * docs/sheets/slides header layout. Must render inside `PdfCollabProvider`.
 */
export function PdfHeaderActions() {
  const { readOnly, creating, setCreating, panelOpen, setPanelOpen } =
    usePdfCollab();
  return (
    <div className="flex items-center gap-2">
      {!readOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              className="h-8 w-8 min-w-8 cursor-pointer border p-0"
              aria-label="Add comment"
              pressed={creating}
              onPressedChange={setCreating}
            >
              <IconMessagePlus size={16} />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Add comment</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            className="h-8 w-8 min-w-8 cursor-pointer border p-0"
            aria-label={panelOpen ? 'Hide comments' : 'Show comments'}
            pressed={panelOpen}
            onPressedChange={setPanelOpen}
          >
            <IconMessage size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>
          {panelOpen ? 'Hide comments' : 'Show comments'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * The PDF viewer with its comment pin overlay, the comments side panel /
 * thread detail, and the new-thread composer. Must render inside
 * `PdfCollabProvider`.
 */
export function PdfCollabBody() {
  const {
    readOnly,
    fileUrl,
    threads,
    panelOpen,
    setPanelOpen,
    creating,
    setCreating,
    activeThreadId,
    setActiveThreadId,
    activeThread,
    pending,
    setPending,
    author,
    store,
    addThread,
    addReply,
    setResolved,
    onActivePageChange,
    closeThreadDetail,
  } = usePdfCollab();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <PdfViewer
          fileUrl={fileUrl}
          onActivePageChange={onActivePageChange}
          renderPageOverlay={(pageIndex) => (
            <PdfCommentLayer
              pageIndex={pageIndex}
              threads={threads}
              creating={creating}
              activeThreadId={activeThreadId}
              onSelectThread={(id) => {
                setActiveThreadId(id);
                setPanelOpen(true);
              }}
              onCreateRegion={(pi, rect) => {
                setPending({ pageIndex: pi, rect });
                setCreating(false);
              }}
            />
          )}
        />
        {panelOpen &&
          (activeThread ? (
            <ThreadDetailPanel
              thread={activeThread}
              author={author}
              readOnly={readOnly}
              onBack={closeThreadDetail}
              onClose={() => {
                setPanelOpen(false);
                closeThreadDetail();
              }}
              onReply={async (body) => {
                await addReply(activeThread.id, body, author);
              }}
              onResolveToggle={async () => {
                await setResolved(activeThread.id, !activeThread.resolved, author);
              }}
              onEdit={async (commentId, body) => {
                await store?.editComment(activeThread.id, commentId, body);
              }}
              onDelete={async (commentId) => {
                const wasRoot = commentId === activeThread.comments[0]?.id;
                await store?.deleteComment(activeThread.id, commentId);
                if (wasRoot) closeThreadDetail();
              }}
            />
          ) : (
            <CommentSidePanel
              threads={threads}
              onJumpTo={(t) => setActiveThreadId(t.id)}
              onClose={() => setPanelOpen(false)}
              renderAnchorLabel={(t) => `Page ${t.anchor.pageIndex + 1}`}
            />
          ))}
      </div>

      {/* New-thread composer for the just-drawn region. */}
      {pending && !readOnly && (
        <div className="border-t p-3">
          <CommentComposer
            submitLabel="Comment"
            autoFocus
            onCancel={() => setPending(null)}
            onSubmit={async (body) => {
              const threadId = await addThread(
                {
                  kind: 'pdf-region',
                  pageIndex: pending.pageIndex,
                  rect: pending.rect,
                },
                body,
                author,
              );
              setPending(null);
              setPanelOpen(true);
              if (threadId) setActiveThreadId(threadId);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Detail view for a single thread: root comment + replies, a reply
 * composer, and a resolve/reopen toggle — swapped in for the thread
 * list when a pin or panel row is selected. Reuses `CommentThreadCard`
 * so the reply/resolve/edit/delete surface matches the rest of the app.
 */
function ThreadDetailPanel({
  thread,
  author,
  readOnly,
  onBack,
  onClose,
  onReply,
  onResolveToggle,
  onEdit,
  onDelete,
}: {
  thread: Thread<PdfRegionAnchor>;
  author: CommentAuthor;
  readOnly: boolean;
  onBack: () => void;
  onClose: () => void;
  onReply: (body: string) => Promise<void>;
  onResolveToggle: () => Promise<void>;
  onEdit: (commentId: string, body: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
}) {
  return (
    <aside
      className="flex h-full w-72 flex-col border-l bg-background shadow-lg"
      aria-label="Comment thread detail"
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          &larr; Back
        </button>
        <span className="text-xs text-muted-foreground">
          Page {thread.anchor.pageIndex + 1}
        </span>
        <button
          type="button"
          className="h-6 w-6 rounded p-0 text-sm hover:bg-muted"
          onClick={onClose}
          aria-label="Close comments panel"
        >
          &times;
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <CommentThreadCard
          thread={thread}
          currentUserId={author.userId}
          readOnly={readOnly}
          onReply={onReply}
          onResolveToggle={onResolveToggle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </aside>
  );
}
