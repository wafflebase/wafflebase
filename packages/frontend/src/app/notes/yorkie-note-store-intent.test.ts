import { describe, it, expect } from 'vitest';
import { Document, Text, converter } from '@yorkie-js/sdk';
import { YorkieNoteStore } from './yorkie-note-store';
import type { YorkieNotesRoot, NotesPresence } from '@/types/notes-document';

/**
 * Intent preservation for concurrent typing in Notes (yorkie-team/yorkie#2309,
 * wafflebase#1114). Two users type a word at the same offset while offline.
 * Both replicas always converge; this checks that the converged text keeps
 * each word contiguous. Typing "backward" (the caret held in place, each
 * character inserted before the previous one) is what used to interleave the
 * words, e.g. `Xab가c나다Y`.
 */

type NoteDoc = Document<YorkieNotesRoot, NotesPresence>;

/**
 * Sends `from`'s pending changes to every peer through the protobuf wire
 * format, then acknowledges them to `from`, standing in for one round trip
 * through a Yorkie server.
 */
function send(from: NoteDoc, peers: NoteDoc[]): void {
  const pb = converter.toChangePack(from.createChangePack());
  const clientSeq = pb.checkpoint!.clientSeq;
  pb.checkpoint!.clientSeq = 0;
  for (const peer of peers) {
    peer.applyChangePack(converter.fromChangePack(pb));
  }
  pb.changes = [];
  pb.checkpoint!.clientSeq = clientSeq;
  from.applyChangePack(converter.fromChangePack(pb));
}

function twoOfflineClients(text: string): [NoteDoc, NoteDoc] {
  const a = new Document<YorkieNotesRoot, NotesPresence>('note-intent');
  const b = new Document<YorkieNotesRoot, NotesPresence>('note-intent');
  a.setActor('000000000000000000000001');
  b.setActor('000000000000000000000002');
  a.update((root) => {
    root.content = new Text();
    root.content.edit(0, 0, text);
  });
  send(a, [b]);
  return [a, b];
}

/** Exchanges both sides' changes made while offline. */
function exchange(a: NoteDoc, b: NoteDoc): void {
  send(a, [b]);
  send(b, [a]);
}

type Typing = 'forward' | 'backward';

function type(store: YorkieNoteStore, at: number, word: string, how: Typing): void {
  const chars = [...word];
  if (how === 'forward') {
    chars.forEach((c, i) => store.editText(at + i, at + i, c));
  } else {
    chars.reverse().forEach((c) => store.editText(at, at, c));
  }
}

describe('YorkieNoteStore concurrent typing intent', () => {
  const cases: Array<[Typing, Typing]> = [
    ['forward', 'forward'],
    ['forward', 'backward'],
    ['backward', 'forward'],
    ['backward', 'backward'],
  ];
  for (const [howA, howB] of cases) {
    // Until the SDK carries the right-origin fix, typing backward on A
    // interleaves (`X가abc나다Y`, `Xab가c나다Y`). Pinned so the fix shows up.
    const test = howA === 'backward' ? it.fails : it;
    test(`keeps both words contiguous: A ${howA}, B ${howB}`, () => {
      const [docA, docB] = twoOfflineClients('XY');
      const storeA = new YorkieNoteStore(docA);
      const storeB = new YorkieNoteStore(docB);

      type(storeA, 1, '가나다', howA);
      type(storeB, 1, 'abc', howB);
      exchange(docA, docB);

      const merged = storeA.getText();
      expect(storeB.getText()).toBe(merged);
      expect(merged).toMatch(/^X(가나다abc|abc가나다)Y$/);

      storeA.dispose?.();
      storeB.dispose?.();
    });
  }
});
