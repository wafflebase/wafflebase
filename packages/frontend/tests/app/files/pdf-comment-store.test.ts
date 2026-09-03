import { describe, it, expect } from 'vitest';
import { Document } from '@yorkie-js/sdk';
import { PdfCommentStore } from '@/app/files/comments/pdf-comment-store';
import { initialPdfRoot, type YorkiePdfRoot } from '@/types/pdf-document';
import type { PdfRegionAnchor, PdfTextAnchor } from '@/types/comments';

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

  it('round-trips a text anchor, copying its per-line rects out of the CRDT', async () => {
    const textAnchor: PdfTextAnchor = {
      kind: 'pdf-text',
      pageIndex: 4,
      rects: [
        { x: 0.1, y: 0.2, w: 0.5, h: 0.02 },
        { x: 0.1, y: 0.23, w: 0.3, h: 0.02 },
      ],
      quote: 'the selected sentence',
    };
    const store = new PdfCommentStore(makeDoc());

    await store.addThread(textAnchor, 'about this line', author);
    const [stored] = await store.listThreads();

    expect(stored.anchor).toEqual(textAnchor);
    // Read back as plain JS, not as live Yorkie proxies, or mutating a thread
    // later would write straight through into the CRDT. Identity against the
    // input proves nothing here — addThread copies the anchor before storing
    // it, so the array we passed in is never the stored one either way. Only
    // mutating what was read and reloading tells a copy from a proxy.
    const readAnchor = stored.anchor as PdfTextAnchor;
    expect(Array.isArray(readAnchor.rects)).toBe(true);
    readAnchor.rects[0].x = 0.99;
    readAnchor.rects.push({ x: 0, y: 0, w: 1, h: 1 });

    const [reloaded] = await store.listThreads();
    expect(reloaded.anchor).toEqual(textAnchor);
  });

  it('keeps region and text threads distinguishable in one document', async () => {
    const store = new PdfCommentStore(makeDoc());
    await store.addThread(anchor, 'on a region', author);
    await store.addThread(
      {
        kind: 'pdf-text',
        pageIndex: 0,
        rects: [{ x: 0, y: 0, w: 0.4, h: 0.02 }],
        quote: 'a phrase',
      },
      'on some text',
      author,
    );

    const kinds = (await store.listThreads()).map((t) => t.anchor.kind).sort();
    expect(kinds).toEqual(['pdf-region', 'pdf-text']);
  });

  it('deleting the root comment removes the whole thread', async () => {
    const store = new PdfCommentStore(makeDoc());
    const t = await store.addThread(anchor, 'root', author);
    await store.deleteComment(t.id, t.comments[0].id);
    expect(await store.listThreads()).toHaveLength(0);
  });
});
