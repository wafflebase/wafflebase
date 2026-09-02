import {
  collectImageRefs,
  isRehostable,
  parseImageRef,
  rewriteImageRefs,
  workspaceImageUrl,
} from './document-image-refs';

const IMG = '11111111-2222-3333-4444-555555555555.png';
const ORIGIN = 'https://api.example.com';

describe('parseImageRef', () => {
  it('reads a relative workspace image URL', () => {
    expect(parseImageRef(`/api/v1/workspaces/ws-1/images/${IMG}`)).toEqual({
      url: `/api/v1/workspaces/ws-1/images/${IMG}`,
      workspaceId: 'ws-1',
      imageId: IMG,
    });
  });

  it('reads an absolute one on our own origin — what a configured API base produces', () => {
    const url = `${ORIGIN}/api/v1/workspaces/ws-1/images/${IMG}`;
    expect(parseImageRef(url, ORIGIN)?.workspaceId).toBe('ws-1');
  });

  it('refuses an absolute URL on a foreign origin', () => {
    // The string comes out of the CRDT, where any collaborator can write it.
    // The frontend applies the same rule for the same reason
    // (`isTrustedWorkspaceImageUrl`), and the backend must not be looser.
    expect(
      parseImageRef(
        `https://attacker.example/api/v1/workspaces/ws-1/images/${IMG}`,
        ORIGIN,
      ),
    ).toBeNull();
    expect(
      parseImageRef(
        `https://user:pw@evil.test/api/v1/workspaces/ws-1/images/${IMG}`,
        ORIGIN,
      ),
    ).toBeNull();
  });

  it('refuses a protocol-relative URL, which is not root-relative', () => {
    expect(
      parseImageRef(`//evil.test/api/v1/workspaces/ws-1/images/${IMG}`, ORIGIN),
    ).toBeNull();
  });

  it('refuses any absolute URL when no origin is configured', () => {
    // The safe direction: a deployment that has not told us its own origin
    // cannot have us guess one.
    expect(
      parseImageRef(`${ORIGIN}/api/v1/workspaces/ws-1/images/${IMG}`),
    ).toBeNull();
  });

  it('refuses a string that merely contains a reference', () => {
    // The whole-string rule. A sheet cell is free-form text, and an earlier
    // revision parsed this as a reference whose `url` was the entire cell —
    // so the rewrite replaced the cell, deleting the prose around it.
    expect(
      parseImageRef(`Logo: /api/v1/workspaces/ws-1/images/${IMG}`),
    ).toBeNull();
    expect(
      parseImageRef(
        `/api/v1/workspaces/ws-1/images/${IMG} /api/v1/workspaces/ws-1/images/${IMG}`,
      ),
    ).toBeNull();
  });

  it('ignores the bucket-root route, which needs no re-hosting', () => {
    // `GET /images/:id` is unauthenticated, so those references keep working
    // across a workspace boundary on their own.
    expect(parseImageRef(`/images/${IMG}`)).toBeNull();
  });

  it('ignores a third-party URL', () => {
    expect(parseImageRef('https://example.com/cat.png')).toBeNull();
  });

  it('refuses an image id that is not a uuid with a known extension', () => {
    // The id names a storage key. A reference tampered into naming something
    // else must not be laundered into a fresh servable id by this path.
    expect(
      parseImageRef('/api/v1/workspaces/ws-1/images/../../secret.png'),
    ).toBeNull();
    expect(
      parseImageRef('/api/v1/workspaces/ws-1/images/not-a-uuid.png'),
    ).toBeNull();
    expect(
      parseImageRef(`/api/v1/workspaces/ws-1/images/${IMG}.exe`),
    ).toBeNull();
  });

  it('refuses a reference carrying a query or fragment', () => {
    // Nothing here writes one, so its presence means the string is not the
    // shape this function claims to understand.
    expect(
      parseImageRef(`/api/v1/workspaces/ws-1/images/${IMG}?v=2`),
    ).toBeNull();
    expect(parseImageRef(`/api/v1/workspaces/ws-1/images/${IMG}#a`)).toBeNull();
  });

  it('ignores non-strings and absurd lengths', () => {
    expect(parseImageRef(42)).toBeNull();
    expect(parseImageRef(null)).toBeNull();
    expect(parseImageRef('x'.repeat(3000))).toBeNull();
  });
});

describe('isRehostable', () => {
  const ref = { url: 'u', workspaceId: 'ws-1', imageId: IMG };

  it('accepts a reference to the source document’s own workspace', () => {
    expect(isRehostable(ref, 'ws-1')).toBe(true);
  });

  it('refuses one naming a different workspace', () => {
    // The workspace id sits in author-written content, so a URL naming someone
    // else's workspace is an ordinary thing for a document to contain.
    // Re-hosting it would have the server read an image out of a workspace the
    // copier cannot reach and write it somewhere they can.
    expect(isRehostable(ref, 'ws-2')).toBe(false);
  });
});

describe('collectImageRefs', () => {
  it('finds references wherever they are nested', () => {
    const root = {
      sheets: { t1: { images: { i1: { url: url('ws-1') } } } },
      slides: [{ elements: [{ data: { url: url('ws-1', OTHER) } }] }],
    };
    expect(
      collectImageRefs(root, 'ws-1')
        .rehostable.map((r) => r.imageId)
        .sort(),
    ).toEqual([IMG, OTHER].sort());
  });

  it('de-duplicates a reference used twice', () => {
    const root = { a: url('ws-1'), b: url('ws-1') };
    expect(collectImageRefs(root, 'ws-1').rehostable).toHaveLength(1);
  });

  it('separates a cross-workspace reference instead of dropping it', () => {
    // Dropped, it would be invisible in the report — a document whose images
    // all belong to another workspace would look identical to one with no
    // images, and a reviewer would approve a listing whose every image 403s.
    const root = { mine: url('ws-1'), theirs: url('ws-2') };
    const found = collectImageRefs(root, 'ws-1');
    expect(found.rehostable.map((r) => r.workspaceId)).toEqual(['ws-1']);
    expect(found.foreign.map((r) => r.workspaceId)).toEqual(['ws-2']);
  });

  it('reports that a document was too deep to scan completely', () => {
    let node: unknown = url('ws-1');
    for (let i = 0; i < 200; i += 1) node = { child: node };
    const found = collectImageRefs(node, 'ws-1');
    expect(found.truncated).toBe(true);
  });

  it('finds the field names the real engines actually use', () => {
    // `SheetImage.src`, `ImageElement.data.src`, `BackgroundImage.src` — the
    // walker is structure-agnostic, but nothing else in this file pins that it
    // was ever checked against the real shapes.
    const root = {
      sheets: { t1: { images: { i1: { src: url('ws-1') } } } },
      slides: [
        {
          background: { image: { src: url('ws-1', OTHER) } },
          elements: [{ data: { src: url('ws-1', THIRD) } }],
        },
      ],
    };
    expect(
      collectImageRefs(root, 'ws-1')
        .rehostable.map((r) => r.imageId)
        .sort(),
    ).toEqual([IMG, OTHER, THIRD].sort());
  });

  it('survives a deeply nested document without blowing the stack', () => {
    let node: unknown = url('ws-1');
    for (let i = 0; i < 500; i += 1) node = { child: node };
    expect(() => collectImageRefs(node, 'ws-1')).not.toThrow();
  });
});

describe('rewriteImageRefs', () => {
  it('replaces only the strings it was given', () => {
    const replacements = new Map([[url('ws-1'), url('ws-9')]]);
    const out = rewriteImageRefs(
      { a: url('ws-1'), b: url('ws-2'), c: 'hello' },
      replacements,
    );
    expect(out).toEqual({ a: url('ws-9'), b: url('ws-2'), c: 'hello' });
  });

  it('rewrites inside arrays and keeps the shape', () => {
    const replacements = new Map([[url('ws-1'), url('ws-9')]]);
    expect(
      rewriteImageRefs({ list: [url('ws-1'), 1, null] }, replacements),
    ).toEqual({ list: [url('ws-9'), 1, null] });
  });
});

const OTHER = '99999999-8888-7777-6666-555555555555.png';
const THIRD = '22222222-3333-4444-5555-666666666666.png';
function url(workspaceId: string, imageId: string = IMG): string {
  return workspaceImageUrl(workspaceId, imageId);
}

describe('rewriteImageRefs and __proto__', () => {
  it('keeps a __proto__ key as data instead of losing it to the setter', () => {
    // `JSON.parse` makes `__proto__` an ordinary own property, and assigning
    // it onto a normal object invokes the prototype setter — dropping the key
    // and changing the result's prototype. That object then goes into a Yorkie
    // root.
    const parsed = JSON.parse('{"__proto__": {"polluted": true}}') as object;
    const out = rewriteImageRefs(parsed, new Map([['a', 'b']]));
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('returns the value untouched when there is nothing to replace', () => {
    const root = { a: 1 };
    expect(rewriteImageRefs(root, new Map())).toBe(root);
  });
});
