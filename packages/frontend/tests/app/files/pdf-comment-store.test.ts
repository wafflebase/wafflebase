import { describe, it, expect } from 'vitest';
import { Document } from '@yorkie-js/sdk';
import { PdfCommentStore } from '@/app/files/comments/pdf-comment-store';
import { initialPdfRoot, type YorkiePdfRoot } from '@/types/pdf-document';
import type { PdfRegionAnchor } from '@/types/comments';

function makeDoc(): Document<YorkiePdfRoot> {
  const doc = new Document<YorkiePdfRoot>('pdf-test');
  doc.update((root) => {
    // Mirror initialRoot seeding for a local (unattached) doc.
    if (!root.comments) root.comments = initialPdfRoot().comments!;
  });
  return doc;
}
const author = { userId: '1', username: 'alice' };
const anchor: PdfRegionAnchor = {
  kind: 'pdf-region',
  pageIndex: 2,
  rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
};

describe('PdfCommentStore', () => {
  it('adds a thread with the given region anchor and lists it', async () => {
    const store = new PdfCommentStore(makeDoc());
    const t = await store.addThread(anchor, 'first note', author);
    expect(t.anchor).toEqual(anchor);
    const threads = await store.listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0].comments[0].body).toBe('first note');
    expect(typeof threads[0].createdAt).toBe('number');
  });

  it('appends replies and resolves', async () => {
    const store = new PdfCommentStore(makeDoc());
    const t = await store.addThread(anchor, 'root', author);
    await store.addReply(t.id, 'reply', author);
    await store.setThreadResolved(t.id, true, author);
    const [only] = await store.listThreads({ resolved: true });
    expect(only.comments.map((c) => c.body)).toEqual(['root', 'reply']);
    expect(only.resolved).toBe(true);
  });

  it('deleting the root comment removes the whole thread', async () => {
    const store = new PdfCommentStore(makeDoc());
    const t = await store.addThread(anchor, 'root', author);
    await store.deleteComment(t.id, t.comments[0].id);
    expect(await store.listThreads()).toHaveLength(0);
  });
});
