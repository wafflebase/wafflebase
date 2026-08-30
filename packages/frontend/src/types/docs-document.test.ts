import { describe, it, expect } from 'vitest';
import { Tree as ReactTree } from '@yorkie-js/react';
import { Tree as SdkTree } from '@yorkie-js/sdk';
import { docsInitialRootForRole, initialDocsRoot } from './docs-document';

describe('initialDocsRoot', () => {
  // A `Tree` is recognized by `instanceof` against the class belonging to
  // whichever copy of the SDK owns the document, and this module is shared by
  // two of them: `@yorkie-js/react`'s provider bundles its own SDK, while
  // `apply-imported-content` drives a plain `@yorkie-js/sdk` client. Whichever
  // class the seed picked, the other path got a plain `CRDTObject` instead of
  // a Tree. The seed therefore carries no CRDT value at all — every consumer
  // creates the Tree in its own realm.
  it('is a realm mismatch waiting to happen, so it seeds no CRDT value', () => {
    expect(SdkTree).not.toBe(ReactTree);
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
