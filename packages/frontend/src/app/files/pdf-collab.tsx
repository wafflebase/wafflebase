import { useEffect, useMemo, useRef, useState } from 'react';
import { YorkieProvider, DocumentProvider, useDocument } from '@yorkie-js/react';
import { IconMessage } from '@tabler/icons-react';

import { PdfViewer } from './pdf-viewer.tsx';
import { PdfCommentLayer } from './pdf-comment-layer.tsx';
import { PdfCommentStore } from './comments/pdf-comment-store.ts';
import { usePdfComments } from './comments/pdf-comments-controller.ts';
import { CommentSidePanel } from '@/components/comments/components/CommentSidePanel.tsx';
import { CommentComposer } from '@/components/comments/components/CommentComposer.tsx';
import { CommentThreadCard } from '@/components/comments/components/CommentThreadCard.tsx';
import { UserPresence } from '@/components/user-presence.tsx';
import { initialPdfRoot, type YorkiePdfRoot } from '@/types/pdf-document.ts';
import type { PdfPresence } from '@/types/users.ts';
import type { CommentAuthor, PdfRect, Thread, PdfRegionAnchor } from '@/types/comments.ts';
import { pdfFileUrl } from '@/api/files.ts';

export type PdfCollabProps = {
  documentId: string;
  title: string;
  readOnly: boolean;
  token?: string;
  presenceUser: { username: string; email: string; photo: string; userId: string };
};

export function PdfCollab(props: PdfCollabProps) {
  const presence: PdfPresence = {
    username: props.presenceUser.username,
    email: props.presenceUser.email,
    photo: props.presenceUser.photo,
  };
  return (
    <YorkieProvider
      rpcAddr={import.meta.env.VITE_YORKIE_RPC_ADDR}
      apiKey={import.meta.env.VITE_YORKIE_PUBLIC_KEY}
      metadata={{ userID: props.presenceUser.username }}
    >
      <DocumentProvider<YorkiePdfRoot, PdfPresence>
        docKey={`pdf-${props.documentId}`}
        initialRoot={initialPdfRoot()}
        initialPresence={presence}
        enableDevtools={import.meta.env.DEV}
      >
        <PdfCollabInner {...props} />
      </DocumentProvider>
    </YorkieProvider>
  );
}

export function PdfCollabInner({
  documentId,
  readOnly,
  token,
  presenceUser,
}: PdfCollabProps) {
  const { doc } = useDocument<YorkiePdfRoot, PdfPresence>();
  const store = useMemo(() => (doc ? new PdfCommentStore(doc) : null), [doc]);
  useEffect(() => () => store?.dispose(), [store]);

  const { threads, addThread, addReply, setResolved } = usePdfComments(store);
  const [panelOpen, setPanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ pageIndex: number; rect: PdfRect } | null>(null);

  const author: CommentAuthor = {
    userId: presenceUser.userId,
    username: presenceUser.username,
    photo: presenceUser.photo || undefined,
  };

  // Broadcast the active page (throttled) for presence.
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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-2 border-b px-3 py-1.5">
        {!readOnly && (
          <button
            type="button"
            aria-pressed={creating}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs hover:bg-muted ${
              creating ? 'bg-muted' : ''
            }`}
            onClick={() => setCreating((v) => !v)}
          >
            Add comment
          </button>
        )}
        <button
          type="button"
          aria-label={panelOpen ? 'Hide comments' : 'Show comments'}
          aria-pressed={panelOpen}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted ${
            panelOpen ? 'bg-muted' : ''
          }`}
          onClick={() => setPanelOpen((v) => !v)}
        >
          <IconMessage size={16} />
        </button>
        <UserPresence />
      </div>

      <div className="flex min-h-0 flex-1">
        <PdfViewer
          fileUrl={pdfFileUrl(documentId, token)}
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
              threads={threads.filter((t) => t.anchor.pageIndex >= 0)}
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
                { kind: 'pdf-region', pageIndex: pending.pageIndex, rect: pending.rect },
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
