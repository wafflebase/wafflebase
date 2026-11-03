import { describe, it, expect } from 'vitest';
import { Tree as ReactTree } from '@yorkie-js/react';
import { Tree as SdkTree } from '@yorkie-js/sdk';
import { docsInitialRootForRole, initialDocsRoot } from './docs-document';

describe('initialDocsRoot', () => {
  // A `Tree` is recognized by `instanceof` against the class belonging to
  // whichever copy of the SDK owns the document. Through 0.7.25,
  // `@yorkie-js/react` bundled its own SDK, so its provider and the plain
  // `@yorkie-js/sdk` client in `apply-imported-content` held different
  // classes, and whichever one the seed picked, the other path got a plain
  // `CRDTObject` instead of a Tree. Since 0.7.26 the React package takes the
  // SDK as a peer (yorkie-js-sdk#1431) and both paths share one class. The
  // seed still carries no CRDT value: every consumer creates the Tree itself.
  it('shares one SDK realm with React, and seeds no CRDT value', () => {
    expect(SdkTree).toBe(ReactTree);
    expect(initialDocsRoot().content).toBeUndefined();
  });

  it('still seeds the comments container', () => {
    expect(initialDocsRoot().comments).toEqual({});
  });

  it('seeds nothing that depends on a class identity', () => {
    for (const value of Object.values(initialDocsRoot())) {
      expect(typeof value).not.toBe('function');
      expect(value?.constructor).toBe(Object);
    }
  });
});

describe('docsInitialRootForRole', () => {
  // The Yorkie SDK writes every `initialRoot` key the document does not
  // already have, on each attach. Seeding from a viewer's client therefore
  // means a viewer creates `comments` on a never-edited document just by
  // opening the share link — a write to a shared document from the one role
  // that must not make them, before any of the editor's read-only machinery
  // exists.
  it('seeds nothing for a viewer', () => {
    expect(docsInitialRootForRole('viewer')).toEqual({});
  });

  it('still seeds for an editor', () => {
    expect(docsInitialRootForRole('editor').comments).toEqual({});
  });

  // An unknown role must not be treated as a viewer by accident — only the
  // viewer role is exempt, everything else keeps the previous behaviour.
  it('seeds for any non-viewer role', () => {
    expect(docsInitialRootForRole('owner').comments).toEqual({});
  });

  it('matches initialDocsRoot for a writer, key for key', () => {
    expect(Object.keys(docsInitialRootForRole('editor')).sort()).toEqual(
      Object.keys(initialDocsRoot()).sort(),
    );
  });
});
