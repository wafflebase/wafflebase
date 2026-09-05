import {
  AnyThread,
  ThreadMap,
  applyAddReply,
  applyAddThread,
  applyDeleteComment,
  applyDeleteThread,
  applyEditComment,
  applySetResolved,
  buildReply,
  buildThread,
  commentAuthorId,
  copyThread,
  findThread,
  fromYorkieMs,
  listThreads,
  normalizeBody,
} from './comment-ops';

const AUTHOR = { userId: '7', username: 'ada' };
const CELL = { kind: 'sheet-cell', tabId: 'tab-1', rowId: 'r1', colId: 'c1' };

function seeded(now = 1_700_000_000_000): {
  map: ThreadMap;
  thread: AnyThread;
} {
  const map: ThreadMap = {};
  const thread = buildThread({
    anchor: { ...CELL },
    body: 'why is this negative?',
    author: AUTHOR,
    now,
  });
  applyAddThread(map, thread);
  return { map, thread };
}

describe('buildThread', () => {
  it('opens a thread with exactly one comment, unresolved', () => {
    const { thread } = seeded();
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0].body).toBe('why is this negative?');
    expect(thread.comments[0].author).toEqual(AUTHOR);
    expect(thread.resolved).toBe(false);
  });

  it('stores timestamps as Long so the editor does not read a 1970 date', () => {
    const now = 1_700_000_000_000;
    const { thread } = seeded(now);
    // Yorkie 0.7.x types an integer-valued number as a 32-bit int, so the
    // frontend stores write bigint. A plain number here would truncate.
    expect(typeof thread.createdAt).toBe('bigint');
    expect(fromYorkieMs(thread.createdAt)).toBe(now);
  });

  it('mints distinct ids for the thread and its comment', () => {
    const { thread } = seeded();
    expect(thread.id).not.toBe(thread.comments[0].id);
    expect(seeded().thread.id).not.toBe(thread.id);
  });
});

describe('copyThread / listThreads', () => {
  it('converts stored Longs back to numbers', () => {
    const { thread } = seeded(1_700_000_000_000);
    const copy = copyThread(thread);
    expect(copy.createdAt).toBe(1_700_000_000_000);
    expect(copy.comments[0].createdAt).toBe(1_700_000_000_000);
  });

  it('sorts threads oldest first', () => {
    const map: ThreadMap = {};
    const older = buildThread({ anchor: { ...CELL }, body: 'a', author: AUTHOR, now: 10 });
    const newer = buildThread({ anchor: { ...CELL }, body: 'b', author: AUTHOR, now: 20 });
    applyAddThread(map, newer);
    applyAddThread(map, older);
    expect(listThreads(map).map((t) => t.comments[0].body)).toEqual(['a', 'b']);
  });

  it('skips map entries that are not threads', () => {
    // A Yorkie object proxy answers `toJSON` with a truthy function, so a key
    // walk can surface something that is not a thread at all.
    const map = { toJSON: (() => '{}') as never } as unknown as ThreadMap;
    expect(listThreads(map)).toEqual([]);
    expect(findThread(map, 'toJSON')).toBeUndefined();
  });

  it('returns an empty list for a document with no comments', () => {
    expect(listThreads(undefined)).toEqual([]);
  });

  it('reads a thread whose comment list is not a real array', () => {
    // The shape that actually reaches these functions inside `doc.update`: a
    // Yorkie array proxy wraps a `CRDTArray`, so `Array.isArray` is **false**
    // for it. Guarding on `Array.isArray` made every stored thread invisible —
    // the comments API read empty and every reply/resolve/delete 404'd — while
    // the plain-object fixtures above passed.
    const { thread } = seeded(42);
    const comments = thread.comments;
    const proxied = {
      ...thread,
      comments: new Proxy(
        {},
        {
          get: (_t, key) =>
            key === 'length'
              ? comments.length
              : key === Symbol.iterator
                ? comments[Symbol.iterator].bind(comments)
                : Reflect.get(comments, key),
        },
      ) as unknown as typeof comments,
    };
    expect(Array.isArray(proxied.comments)).toBe(false);
    const map = { [thread.id]: proxied } as unknown as ThreadMap;

    expect(findThread(map, thread.id)).toBeDefined();
    expect(listThreads(map).map((t) => t.comments[0].body)).toEqual([
      'why is this negative?',
    ]);
  });
});

describe('applyAddReply', () => {
  it('appends to the thread it was replied on', () => {
    const { map, thread } = seeded();
    applyAddReply(thread, buildReply({ body: 'fixed', author: AUTHOR, now: 5 }));
    expect(listThreads(map)[0].comments.map((c) => c.body)).toEqual([
      'why is this negative?',
      'fixed',
    ]);
  });
});

describe('applySetResolved', () => {
  it('records who resolved it and when', () => {
    const { thread } = seeded();
    applySetResolved(thread, true, AUTHOR, 999);
    expect(thread.resolved).toBe(true);
    expect(thread.resolvedBy).toEqual(AUTHOR);
    expect(fromYorkieMs(thread.resolvedAt!)).toBe(999);
  });

  it('clears the resolution when reopened', () => {
    const { thread } = seeded();
    applySetResolved(thread, true, AUTHOR, 999);
    applySetResolved(thread, false, AUTHOR, 1000);
    expect(thread.resolved).toBe(false);
    expect(thread.resolvedAt).toBeUndefined();
    expect(thread.resolvedBy).toBeUndefined();
  });

  it('reopens a never-resolved thread without deleting absent keys', () => {
    // Yorkie's object proxy routes `delete` to `RHTPQMap.deleteByKey`, which
    // throws `fail to find <key>` for a key that was never set — so an
    // unguarded `delete thread.resolvedAt` turned `PATCH {resolved:false}` on
    // an open thread into a 500. A proxy that throws the same way stands in.
    const { thread } = seeded();
    const deleted: Array<string | symbol> = [];
    const strict = new Proxy(thread as Record<string, unknown>, {
      deleteProperty: (target, key) => {
        if (!(key in target)) throw new Error(`fail to find ${String(key)}`);
        deleted.push(key);
        delete target[key as string];
        return true;
      },
    }) as unknown as AnyThread;

    expect(() => applySetResolved(strict, false, AUTHOR, 1000)).not.toThrow();
    expect(deleted).toEqual([]);
    expect(strict.resolved).toBe(false);
  });
});

describe('applyEditComment', () => {
  it('rewrites the body in place and stamps editedAt', () => {
    const { thread } = seeded();
    const commentId = thread.comments[0].id;
    const edited = applyEditComment(thread, commentId, 'reworded', 2_000);

    expect(edited).toMatchObject({ id: commentId, body: 'reworded' });
    expect(edited!.editedAt).toBe(2_000);
    // The stored comment object is mutated, never replaced: swapping the
    // element would clobber a concurrent write to a sibling field.
    expect(thread.comments[0].body).toBe('reworded');
    expect(fromYorkieMs(thread.comments[0].editedAt!)).toBe(2_000);
  });

  it('reports an unknown comment id rather than editing something else', () => {
    const { thread } = seeded();
    expect(applyEditComment(thread, 'nope', 'x', 1)).toBeUndefined();
    expect(thread.comments[0].body).toBe('why is this negative?');
  });

  it('refuses an empty body, the engine’s own rule', () => {
    const { thread } = seeded();
    expect(() =>
      applyEditComment(thread, thread.comments[0].id, '   ', 1),
    ).toThrow();
  });
});

describe('commentAuthorId', () => {
  it('reads the stored id as a string, and nothing otherwise', () => {
    const { thread } = seeded();
    expect(commentAuthorId(thread.comments[0])).toBe('7');
    expect(commentAuthorId(undefined)).toBeNull();
    expect(
      commentAuthorId({ ...thread.comments[0], author: {} as never }),
    ).toBeNull();
  });
});

describe('applyDeleteComment', () => {
  it('deletes the whole thread when the opening comment goes', () => {
    const { map, thread } = seeded();
    applyAddReply(thread, buildReply({ body: 'reply', author: AUTHOR, now: 5 }));
    expect(
      applyDeleteComment(map, thread.id, thread.comments[0].id),
    ).toBe('thread_deleted');
    expect(map[thread.id]).toBeUndefined();
  });

  it('deletes only the reply when a reply goes', () => {
    const { map, thread } = seeded();
    const reply = buildReply({ body: 'reply', author: AUTHOR, now: 5 });
    applyAddReply(thread, reply);
    expect(applyDeleteComment(map, thread.id, reply.id)).toBe(
      'comment_deleted',
    );
    expect(map[thread.id].comments).toHaveLength(1);
  });

  it('reports not_found for an unknown thread or comment', () => {
    const { map, thread } = seeded();
    expect(applyDeleteComment(map, 'nope', 'x')).toBe('not_found');
    expect(applyDeleteComment(map, thread.id, 'nope')).toBe('not_found');
  });
});

describe('applyDeleteThread', () => {
  it('removes the thread and reports whether it existed', () => {
    const { map, thread } = seeded();
    expect(applyDeleteThread(map, thread.id)).toBe(true);
    expect(applyDeleteThread(map, thread.id)).toBe(false);
  });
});

describe('normalizeBody', () => {
  it('keeps the body verbatim and rejects a whitespace-only one', () => {
    // Same rule as `assertNonEmpty` in `@wafflebase/sheets`: emptiness is
    // judged on the trimmed value, the content is preserved — so an
    // API-written comment matches the same text typed in the editor.
    expect(normalizeBody('  hi  ')).toBe('  hi  ');
    expect(normalizeBody('line one\nline two')).toBe('line one\nline two');
    expect(normalizeBody('   ')).toBeNull();
    expect(normalizeBody('')).toBeNull();
    expect(normalizeBody(42)).toBeNull();
    expect(normalizeBody(undefined)).toBeNull();
  });
});

describe('copyThread anchor detachment', () => {
  it('detaches nested anchor values instead of spreading proxies out', () => {
    // A PDF anchor's `rect` and a docs anchor's `posRange` are nested
    // objects: a shallow spread would hand live Yorkie proxies to
    // `res.json()`, the bug `copyAnchor` in pdf-comment-store.ts prevents.
    const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const thread = buildThread({
      anchor: { kind: 'pdf-region', pageIndex: 1, rect },
      body: 'illegible',
      author: AUTHOR,
      now: 5,
    });
    const copy = copyThread(thread);
    expect(copy.anchor).toEqual({
      kind: 'pdf-region',
      pageIndex: 1,
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    });
    expect(copy.anchor.rect).not.toBe(rect);
  });

  it('detaches an anchor array through the proxy toJSON, not a hand walk', () => {
    // A Yorkie *array* proxy answers `Array.isArray` false, so a hand walk
    // reads it as an object and yields `{createdAt, movedAt}` CRDT metadata.
    // Two live anchor shapes carry arrays — `docs-range.posRange` and
    // `pdf-text.rects` — so this is what every comment read on a doc or PDF
    // document returned.
    const posRange = [{ offset: 3 }, { offset: 9 }];
    const fakeArrayProxy = {
      length: posRange.length,
      0: posRange[0],
      1: posRange[1],
      createdAt: 'crdt-ts',
      movedAt: 'crdt-ts',
      [Symbol.iterator]: () => posRange[Symbol.iterator](),
    };
    const anchorProxy = {
      kind: 'docs-range',
      blockId: 'b1',
      posRange: fakeArrayProxy,
      quotedText: 'hi',
      toJSON: () =>
        JSON.stringify({
          kind: 'docs-range',
          blockId: 'b1',
          posRange,
          quotedText: 'hi',
        }),
    };

    const copy = copyThread({
      id: 't1',
      anchor: anchorProxy as never,
      comments: [],
      resolved: false,
      createdAt: 1,
    });

    expect(copy.anchor.kind).toBe('docs-range');
    expect(copy.anchor.posRange).toEqual([{ offset: 3 }, { offset: 9 }]);
    expect(copy.anchor).not.toHaveProperty('toJSON');
  });
});
