import { describe, it, expect } from 'vitest';
import { docsInitialRootForRole, initialDocsRoot } from './docs-document';

describe('docsInitialRootForRole', () => {
  // The Yorkie SDK writes every `initialRoot` key the document does not
  // already have, on each attach. Seeding from a viewer's client therefore
  // means a viewer creates `content` and `comments` on a never-edited document
  // just by opening the share link — a write to a shared document from the one
  // role that must not make them, before any of the editor's read-only
  // machinery exists.
  it('seeds nothing for a viewer', () => {
    expect(docsInitialRootForRole('viewer')).toEqual({});
  });

  it('still seeds for an editor', () => {
    const root = docsInitialRootForRole('editor');
    expect(root.comments).toEqual({});
    expect(root.content).toBeDefined();
  });

  // An unknown role must not be treated as a viewer by accident — only the
  // viewer role is exempt, everything else keeps the previous behaviour.
  it('seeds for any non-viewer role', () => {
    expect(docsInitialRootForRole('owner').content).toBeDefined();
  });

  it('matches initialDocsRoot for a writer, key for key', () => {
    expect(Object.keys(docsInitialRootForRole('editor')).sort()).toEqual(
      Object.keys(initialDocsRoot()).sort(),
    );
  });
});
