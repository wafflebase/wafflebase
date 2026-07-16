# Notes (Markdown) Document Type — Implementation Plan (P1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth collaborative document type — a CodeMirror-based markdown note (`note`) ported from CodePair — as a new `@wafflebase/notes` engine package wired into the existing document/collaboration infrastructure.

**Architecture:** The whole note is one Yorkie `Text` CRDT at `root.content` (byte-compatible with CodePair). CodePair's CodeMirror↔Yorkie binding is re-expressed against a thin `NoteStore` interface: the engine's CodeMirror view talks only to `NoteStore`; `MemNoteStore` backs it with a plain string for tests; the frontend's `YorkieNoteStore` backs it with the Yorkie Text CRDT + presence. Collaboration/sharing/auth are inherited unchanged by registering a `note-` docKey prefix.

**Tech Stack:** CodeMirror 6 (`@codemirror/lang-markdown`, `@codemirror/state`, `@codemirror/view`, `codemirror`), `markdown-it` (preview), `@yorkie-js/sdk` 0.7.8, Vite library build (`vite-plugin-dts`), Vitest + jsdom, React (frontend wiring), NestJS + Prisma (backend type registration).

## Global Constraints

- Document type discriminator value: **`'note'`** (singular). Package: **`@wafflebase/notes`** (plural). docKey prefix: **`note-`**. Route: **`/n/:id`**. (Mirrors the existing `sheet`/`sheets`/`sheet-`/`/s/` pattern exactly.)
- Yorkie SDK is pinned to **`0.7.8`** (frontend) — CodePair used `0.7.12`. Only use stable `Text` + presence APIs: `edit`, `toString`, `indexRangeToPosRange`, `posRangeToIndexRange`, `getOthersPresences`, `presence.set` (partial-merge). Verify each against 0.7.8 (Task 2, Step 0).
- Yorkie doc root schema is frozen for P1: `{ content: yorkie.Text }`. Do not add fields — schema changes break CodePair migration compatibility (P3).
- Engine must never import the DOM-only pieces into the `./node` entry; the `.` (browser) entry may.
- Every commit must pass `pnpm verify:fast` (lint + unit tests). Commit subject ≤70 chars; blank line 2; body explains why. End commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- AI/RAG, image upload, export, revisions, and vim mode are OUT of P1 scope (P2). WYSIWYG is out of scope entirely.
- Work on branch `feat/notes-markdown-type` (already created).

---

### Task 1: Register the `note` document type (backend)

Backend acceptance of `type: 'note'` and the docKey prefix. These two files gate the entire feature — without the prefix the auth/edit webhooks reject every note doc. No engine dependency, so this ships first.

**Files:**
- Modify: `packages/backend/src/yorkie/yorkie-doc-key.ts`
- Modify: `packages/backend/src/document/document.dto.ts`
- Test: `packages/backend/src/yorkie/yorkie-doc-key.spec.ts` (create if absent)

**Interfaces:**
- Produces: `yorkieDocKey('note', id) === 'note-'+id`; `parseYorkieDocKey('note-'+id) === { type: 'note', id }`; `'note'` accepted by `CreateDocumentDto`/`CreateDocumentInWorkspaceDto`.

- [ ] **Step 1: Write the failing test**

Create/append `packages/backend/src/yorkie/yorkie-doc-key.spec.ts`:

```ts
import { yorkieDocKey, parseYorkieDocKey, yorkieDocKeyPrefix } from './yorkie-doc-key';

describe('yorkie-doc-key notes', () => {
  it('builds a note- prefixed key', () => {
    expect(yorkieDocKey('note', 'abc')).toBe('note-abc');
    expect(yorkieDocKeyPrefix('note')).toBe('note-');
  });
  it('parses a note- key back to type note', () => {
    expect(parseYorkieDocKey('note-abc')).toEqual({ type: 'note', id: 'abc' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- yorkie-doc-key`
Expected: FAIL — `yorkieDocKeyPrefix('note')` throws `Unknown document type: note`.

- [ ] **Step 3: Add the `note` prefix**

In `packages/backend/src/yorkie/yorkie-doc-key.ts`:

Change the union:
```ts
export type DocumentTypeLike = 'sheet' | 'doc' | 'slides' | 'pdf' | 'note';
```
Add to the prefixes object:
```ts
export const YORKIE_DOC_KEY_PREFIXES = {
  sheet: 'sheet-',
  doc: 'doc-',
  slides: 'slides-',
  pdf: 'pdf-',
  note: 'note-',
} as const;
```
Add the switch case (before `default:`):
```ts
    case 'note':
      return YORKIE_DOC_KEY_PREFIXES.note;
```

- [ ] **Step 4: Allow `note` in the DTO**

In `packages/backend/src/document/document.dto.ts`, extend the tuple:
```ts
const DOCUMENT_TYPES = ['sheet', 'doc', 'slides', 'pdf', 'note'] as const;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/backend test -- yorkie-doc-key`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/yorkie/yorkie-doc-key.ts packages/backend/src/document/document.dto.ts packages/backend/src/yorkie/yorkie-doc-key.spec.ts
git commit -m "Notes: register note document type + docKey prefix"
```

---

### Task 2: Scaffold the `@wafflebase/notes` engine package

Create the package skeleton (configs + dependency manifest + empty barrels) so later tasks build against a real package. Mirrors `packages/docs` exactly.

**Files:**
- Create: `packages/notes/package.json`
- Create: `packages/notes/tsconfig.json`
- Create: `packages/notes/vite.config.ts`
- Create: `packages/notes/vite.build.ts`
- Create: `packages/notes/src/index.ts` (temporary empty barrel)
- Create: `packages/notes/src/node.ts` (temporary empty barrel)

**Interfaces:**
- Produces: workspace package `@wafflebase/notes` resolvable via `pnpm install`; `pnpm --filter @wafflebase/notes build` and `typecheck` succeed on an empty barrel.

- [ ] **Step 0: Verify Yorkie 0.7.8 API surface (spike, no commit)**

Run:
```bash
cd packages/frontend && node -e "const y=require('@yorkie-js/sdk'); const t=new y.Text(); t.edit(0,0,'hi'); console.log(t.toString(), typeof t.indexRangeToPosRange, typeof t.posRangeToIndexRange)"
```
Expected: prints `hi function function`. If either helper is `undefined`, STOP and re-plan the presence conversion (0.7.8 API differs from 0.7.12). Return to repo root afterward.

- [ ] **Step 1: Write `packages/notes/package.json`**

```json
{
  "name": "@wafflebase/notes",
  "version": "0.1.0",
  "private": true,
  "license": "Apache-2.0",
  "description": "CodeMirror-based collaborative markdown note editor for Wafflebase",
  "type": "module",
  "files": ["dist"],
  "main": "dist/wafflebase-notes.cjs",
  "module": "dist/wafflebase-notes.es.js",
  "types": "dist/wafflebase-notes.es.d.ts",
  "exports": {
    ".": {
      "node": {
        "types": "./dist/node.d.ts",
        "import": "./dist/node.js",
        "require": "./dist/node.cjs",
        "default": "./dist/node.js"
      },
      "types": "./dist/wafflebase-notes.es.d.ts",
      "import": "./dist/wafflebase-notes.es.js",
      "require": "./dist/wafflebase-notes.cjs",
      "default": "./dist/wafflebase-notes.es.js"
    },
    "./node": {
      "types": "./dist/node.d.ts",
      "import": "./dist/node.js",
      "require": "./dist/node.cjs",
      "default": "./dist/node.js"
    }
  },
  "scripts": {
    "dev": "vite",
    "test": "vitest --run",
    "test:watch": "vitest --watch",
    "build": "vite --config vite.build.ts build",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@vitest/coverage-v8": "4.1.8",
    "jsdom": "^28.0.0",
    "prettier": "^3.3.2",
    "typescript": "^5.9.3",
    "vite": "^6.4.2",
    "vite-plugin-dts": "^4.5.3",
    "vitest": "^4.1.8"
  },
  "dependencies": {
    "@codemirror/commands": "^6.1.2",
    "@codemirror/lang-markdown": "^6.5.0",
    "@codemirror/state": "^6.5.4",
    "@codemirror/view": "^6.23.1",
    "@uiw/codemirror-extensions-basic-setup": "^4.25.4",
    "@uiw/codemirror-theme-xcode": "^4.25.4",
    "codemirror": "^6.0.2",
    "markdown-it": "^14.1.0"
  },
  "peerDependencies": {
    "@yorkie-js/sdk": "0.7.8"
  }
}
```

Note: `@yorkie-js/sdk` is a **peer** dependency (types only — the engine imports Yorkie types in `NoteStore`'s frontend consumer, not in engine runtime code; keep it peer so the frontend's single 0.7.8 copy is used). `@types/markdown-it` is added in Task 6 where markdown-it is first imported.

- [ ] **Step 2: Write `packages/notes/tsconfig.json`** (identical to docs)

```jsonc
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "strictNullChecks": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 3: Write `packages/notes/vite.config.ts`** (dev/test)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
});
```

- [ ] **Step 4: Write `packages/notes/vite.build.ts`** (library build)

```ts
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: {
        'wafflebase-notes.es': 'src/index.ts',
        node: 'src/node.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        if (entryName === 'node') {
          return format === 'cjs' ? 'node.cjs' : 'node.js';
        }
        return format === 'cjs' ? 'wafflebase-notes.cjs' : 'wafflebase-notes.es.js';
      },
    },
    rollupOptions: {
      // Yorkie is a peer dep supplied by the frontend; never bundle it.
      external: ['@yorkie-js/sdk'],
    },
  },
  plugins: [dts({ rollupTypes: true })],
});
```

- [ ] **Step 5: Write temporary empty barrels**

`packages/notes/src/index.ts`:
```ts
export {};
```
`packages/notes/src/node.ts`:
```ts
export {};
```

- [ ] **Step 6: Install + verify build**

Run: `pnpm install`
Then: `pnpm --filter @wafflebase/notes typecheck && pnpm --filter @wafflebase/notes build`
Expected: install links the workspace package; typecheck passes; build emits `dist/` with `wafflebase-notes.es.js` + `node.js`.

- [ ] **Step 7: Commit**

```bash
git add packages/notes/package.json packages/notes/tsconfig.json packages/notes/vite.config.ts packages/notes/vite.build.ts packages/notes/src/index.ts packages/notes/src/node.ts pnpm-lock.yaml
git commit -m "Notes: scaffold @wafflebase/notes engine package"
```

---

### Task 3: `NoteStore` interface + `MemNoteStore`

The persistence abstraction the engine talks to, plus the in-memory test backing. Text-oriented (not block-oriented like `DocStore`) because a note is one markdown string.

**Files:**
- Create: `packages/notes/src/types.ts`
- Create: `packages/notes/src/store/store.ts`
- Create: `packages/notes/src/store/memory.ts`
- Test: `packages/notes/src/store/memory.test.ts`

**Interfaces:**
- Produces:
  - `type Unsubscribe = () => void`
  - `interface NoteTextChange { from: number; to: number; insert: string }`
  - `type NoteRemoteChange = { type: 'edits'; changes: NoteTextChange[] } | { type: 'replace'; content: string }`
  - `interface NotePeerSelection { clientID: string; from: number; to: number; color: string; name: string }`
  - `interface NoteStore { getText(): string; editText(from:number,to:number,insert:string): void; subscribeRemote(l:(c:NoteRemoteChange)=>void): Unsubscribe; setLocalSelection(anchor:number, head:number|null): void; getPeerSelections(): NotePeerSelection[]; subscribePresence(l:()=>void): Unsubscribe }`
  - `class MemNoteStore implements NoteStore` (constructor `(text?: string)`).

- [ ] **Step 1: Write the failing test**

`packages/notes/src/store/memory.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MemNoteStore } from './memory.js';

describe('MemNoteStore', () => {
  it('returns initial text', () => {
    expect(new MemNoteStore('hello').getText()).toBe('hello');
    expect(new MemNoteStore().getText()).toBe('');
  });
  it('applies an insert edit', () => {
    const s = new MemNoteStore('hello');
    s.editText(5, 5, ' world');
    expect(s.getText()).toBe('hello world');
  });
  it('applies a replace-range edit', () => {
    const s = new MemNoteStore('hello world');
    s.editText(0, 5, 'goodbye');
    expect(s.getText()).toBe('goodbye world');
  });
  it('has no peers and no-op presence', () => {
    const s = new MemNoteStore('x');
    expect(s.getPeerSelections()).toEqual([]);
    expect(typeof s.subscribeRemote(() => {})).toBe('function');
    expect(typeof s.subscribePresence(() => {})).toBe('function');
    s.setLocalSelection(0, 1); // no throw
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/notes test -- memory`
Expected: FAIL — cannot resolve `./memory.js`.

- [ ] **Step 3: Write `packages/notes/src/types.ts`**

```ts
/** Unsubscribe handle returned by store subscriptions. */
export type Unsubscribe = () => void;
```

- [ ] **Step 4: Write `packages/notes/src/store/store.ts`**

```ts
import type { Unsubscribe } from '../types.js';

/** A single incremental text change, in CodeMirror index coordinates. */
export interface NoteTextChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * A remote change delivered to the editor view: either incremental edits
 * (from a peer's `Text.edit`) or a full replacement (Yorkie snapshot, or the
 * `content` object itself being replaced).
 */
export type NoteRemoteChange =
  | { type: 'edits'; changes: NoteTextChange[] }
  | { type: 'replace'; content: string };

/** A peer's selection, in CodeMirror index coordinates. */
export interface NotePeerSelection {
  clientID: string;
  from: number;
  to: number;
  color: string;
  name: string;
}

/**
 * NoteStore — persistence abstraction for a markdown note.
 *
 * Mirrors the docs package's DocStore / sheets' Store pattern: the engine's
 * CodeMirror view talks only to this interface. MemNoteStore backs it with a
 * plain string (tests); the frontend's YorkieNoteStore backs it with a Yorkie
 * Text CRDT + presence (collaboration). All coordinates are CodeMirror
 * character indices; CRDT position translation lives inside YorkieNoteStore.
 */
export interface NoteStore {
  /** Current full markdown text. */
  getText(): string;
  /** Apply a local edit (originating in the editor) to the model. */
  editText(from: number, to: number, insert: string): void;
  /**
   * Subscribe to remote changes. The listener receives changes already
   * translated to CodeMirror coordinates. MemNoteStore never emits.
   */
  subscribeRemote(listener: (change: NoteRemoteChange) => void): Unsubscribe;
  /**
   * Publish the local selection so peers can render a remote caret.
   * `head === null` clears the local selection.
   */
  setLocalSelection(anchor: number, head: number | null): void;
  /** Peer selections (excludes self), in CodeMirror coordinates. */
  getPeerSelections(): NotePeerSelection[];
  /** Subscribe to peer presence changes. MemNoteStore never emits. */
  subscribePresence(listener: () => void): Unsubscribe;
}
```

- [ ] **Step 5: Write `packages/notes/src/store/memory.ts`**

```ts
import type { NoteStore, NotePeerSelection, NoteRemoteChange } from './store.js';
import type { Unsubscribe } from '../types.js';

/**
 * In-memory NoteStore for tests and non-collaborative use. Holds the markdown
 * as a plain string; never emits remote changes or peer presence.
 */
export class MemNoteStore implements NoteStore {
  private text: string;

  constructor(text = '') {
    this.text = text;
  }

  getText(): string {
    return this.text;
  }

  editText(from: number, to: number, insert: string): void {
    this.text = this.text.slice(0, from) + insert + this.text.slice(to);
  }

  subscribeRemote(_listener: (change: NoteRemoteChange) => void): Unsubscribe {
    return () => {};
  }

  setLocalSelection(_anchor: number, _head: number | null): void {
    // no-op: no peers to publish to
  }

  getPeerSelections(): NotePeerSelection[] {
    return [];
  }

  subscribePresence(_listener: () => void): Unsubscribe {
    return () => {};
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/notes test -- memory`
Expected: PASS (5 assertions).

- [ ] **Step 7: Commit**

```bash
git add packages/notes/src/types.ts packages/notes/src/store/store.ts packages/notes/src/store/memory.ts packages/notes/src/store/memory.test.ts
git commit -m "Notes: NoteStore interface + MemNoteStore"
```

---

### Task 4: CodeMirror↔store sync binding

Ports CodePair's `yorkieSync` to route through `NoteStore` instead of the Yorkie facet: local CM edits → `store.editText`; remote changes → CM transactions tagged `remote` (and excluded from local undo history).

**Files:**
- Create: `packages/notes/src/view/note-sync.ts`
- Test: `packages/notes/src/view/note-sync.test.ts`

**Interfaces:**
- Consumes: `NoteStore` (Task 3).
- Produces:
  - `noteStoreFacet: Facet<NoteStore, NoteStore>`
  - `noteSync: ViewPlugin` (CodeMirror extension). Provided together via `noteStoreFacet.of(store)`.

- [ ] **Step 1: Write the failing test** (jsdom integration over MemNoteStore + a controllable remote store)

`packages/notes/src/view/note-sync.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MemNoteStore } from '../store/memory.js';
import type { NoteRemoteChange, NoteStore } from '../store/store.js';
import { noteStoreFacet, noteSync } from './note-sync.js';

function mount(store: NoteStore) {
  const view = new EditorView({
    state: EditorState.create({
      doc: store.getText(),
      extensions: [noteStoreFacet.of(store), noteSync],
    }),
  });
  return view;
}

describe('noteSync', () => {
  it('pushes local edits into the store', () => {
    const store = new MemNoteStore('');
    const view = mount(store);
    view.dispatch({ changes: { from: 0, insert: 'hello' }, userEvent: 'input.type' });
    expect(store.getText()).toBe('hello');
    view.destroy();
  });

  it('applies remote edits into the editor without echoing back', () => {
    // A store that lets the test emit a remote change on demand.
    let emit: (c: NoteRemoteChange) => void = () => {};
    const backing = new MemNoteStore('hello');
    const store: NoteStore = {
      getText: () => backing.getText(),
      editText: (f, t, i) => backing.editText(f, t, i),
      subscribeRemote: (l) => { emit = l; return () => {}; },
      setLocalSelection: () => {},
      getPeerSelections: () => [],
      subscribePresence: () => () => {},
    };
    const view = mount(store);
    const before = backing.getText();
    emit({ type: 'edits', changes: [{ from: 5, to: 5, insert: ' world' }] });
    expect(view.state.doc.toString()).toBe('hello world');
    // Remote application must NOT have called editText again (no echo):
    expect(backing.getText()).toBe(before);
    view.destroy();
  });

  it('applies a full replacement', () => {
    let emit: (c: NoteRemoteChange) => void = () => {};
    const store: NoteStore = {
      getText: () => 'old',
      editText: () => {},
      subscribeRemote: (l) => { emit = l; return () => {}; },
      setLocalSelection: () => {},
      getPeerSelections: () => [],
      subscribePresence: () => () => {},
    };
    const view = mount(store);
    emit({ type: 'replace', content: 'brand new' });
    expect(view.state.doc.toString()).toBe('brand new');
    view.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/notes test -- note-sync`
Expected: FAIL — cannot resolve `./note-sync.js`.

- [ ] **Step 3: Write `packages/notes/src/view/note-sync.ts`**

```ts
import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import type { NoteStore, NoteRemoteChange } from '../store/store.js';

/** Facet carrying the NoteStore into CodeMirror plugins. */
export const noteStoreFacet = cmState.Facet.define<NoteStore, NoteStore>({
  combine(inputs) {
    return inputs[inputs.length - 1];
  },
});

class NoteSyncPluginValue implements cmView.PluginValue {
  private store: NoteStore;
  private unsub: () => void;

  constructor(view: cmView.EditorView) {
    this.store = view.state.facet(noteStoreFacet);
    this.unsub = this.store.subscribeRemote((change) => {
      this.applyRemote(view, change);
    });
  }

  /** Apply a remote change as a CodeMirror transaction, excluded from local
   *  history and tagged `remote` so our own `update()` skips it (no echo). */
  private applyRemote(view: cmView.EditorView, change: NoteRemoteChange): void {
    const base = {
      annotations: [
        cmState.Transaction.remote.of(true),
        cmState.Transaction.addToHistory.of(false),
      ],
    };
    if (change.type === 'replace') {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: change.content },
        ...base,
      });
      return;
    }
    // Apply each edit as its own transaction so sequential coordinates from
    // the CRDT remain valid (matches CodePair's per-op dispatch).
    for (const c of change.changes) {
      const docLen = view.state.doc.length;
      view.dispatch({
        changes: {
          from: Math.min(Math.max(0, c.from), docLen),
          to: Math.min(Math.max(0, c.to), docLen),
          insert: c.insert,
        },
        ...base,
      });
    }
  }

  update(update: cmView.ViewUpdate): void {
    if (!update.docChanged) return;
    for (const tr of update.transactions) {
      if (tr.annotation(cmState.Transaction.remote)) continue;
      const events = ['input', 'delete', 'move', 'undo', 'redo'];
      if (!events.some((e) => tr.isUserEvent(e))) continue;
      let adj = 0;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const insertText = inserted.toJSON().join('\n');
        this.store.editText(fromA + adj, toA + adj, insertText);
        adj += insertText.length - (toA - fromA);
      });
    }
  }

  destroy(): void {
    this.unsub();
  }
}

export const noteSync = cmView.ViewPlugin.fromClass(NoteSyncPluginValue);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/notes test -- note-sync`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/notes/src/view/note-sync.ts packages/notes/src/view/note-sync.test.ts
git commit -m "Notes: CodeMirror<->store sync binding"
```

---

### Task 5: Remote selection (peer carets)

Ports CodePair's `remoteSelection.ts` to read `store.getPeerSelections()` and push `store.setLocalSelection()`. Drops `lib0`/`lodash` (uses plain DOM + store coordinates).

**Files:**
- Create: `packages/notes/src/view/remote-selection.ts`
- Test: `packages/notes/src/view/remote-selection.test.ts`

**Interfaces:**
- Consumes: `NoteStore`, `noteStoreFacet` (Task 4).
- Produces: `noteRemoteSelections: ViewPlugin`, `noteRemoteSelectionsTheme: Extension`.

- [ ] **Step 1: Write the failing test**

`packages/notes/src/view/remote-selection.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { NoteStore, NotePeerSelection } from '../store/store.js';
import { noteStoreFacet } from './note-sync.js';
import { noteRemoteSelections, noteRemoteSelectionsTheme } from './remote-selection.js';

function storeWithPeers(peers: NotePeerSelection[]): NoteStore & { setLocal: ReturnType<typeof vi.fn> } {
  const setLocal = vi.fn();
  return {
    getText: () => 'hello world',
    editText: () => {},
    subscribeRemote: () => () => {},
    setLocalSelection: setLocal,
    getPeerSelections: () => peers,
    subscribePresence: () => () => {},
    setLocal,
  } as NoteStore & { setLocal: ReturnType<typeof vi.fn> };
}

describe('noteRemoteSelections', () => {
  it('renders a decoration widget for a peer selection', () => {
    const store = storeWithPeers([
      { clientID: 'c1', from: 0, to: 5, color: '#f00', name: 'Ada' },
    ]);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: store.getText(),
        extensions: [noteStoreFacet.of(store), noteRemoteSelectionsTheme, noteRemoteSelections],
      }),
    });
    // The peer caret carries the peer's name.
    expect(view.dom.textContent).toContain('Ada');
    view.destroy();
    parent.remove();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/notes test -- remote-selection`
Expected: FAIL — cannot resolve `./remote-selection.js`.

- [ ] **Step 3: Write `packages/notes/src/view/remote-selection.ts`**

```ts
import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import type { NoteStore } from '../store/store.js';
import { noteStoreFacet } from './note-sync.js';

export const noteRemoteSelectionsTheme = cmView.EditorView.baseTheme({
  '.cm-ySelection': {},
  '.cm-ySelectionCaret': {
    position: 'relative',
    borderLeft: '1px solid black',
    borderRight: '1px solid black',
    marginLeft: '-1px',
    marginRight: '-1px',
    boxSizing: 'border-box',
    display: 'inline',
  },
  '.cm-ySelectionCaretDot': {
    borderRadius: '50%',
    position: 'absolute',
    width: '.4em',
    height: '.4em',
    top: '-.2em',
    left: '-.2em',
    backgroundColor: 'inherit',
    boxSizing: 'border-box',
  },
  '.cm-ySelectionInfo': {
    position: 'absolute',
    top: '-1.05em',
    left: '-1px',
    fontSize: '.75em',
    fontFamily: 'serif',
    fontStyle: 'normal',
    fontWeight: 'normal',
    lineHeight: 'normal',
    userSelect: 'none',
    color: 'white',
    paddingLeft: '2px',
    paddingRight: '2px',
    zIndex: '101',
    backgroundColor: 'inherit',
    whiteSpace: 'nowrap',
  },
});

const remoteSelAnnotation: cmState.AnnotationType<Array<number>> =
  cmState.Annotation.define();

class NoteCaretWidget extends cmView.WidgetType {
  constructor(
    readonly color: string,
    readonly name: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-ySelectionCaret';
    span.style.backgroundColor = this.color;
    span.style.borderColor = this.color;
    const dot = document.createElement('div');
    dot.className = 'cm-ySelectionCaretDot';
    const info = document.createElement('div');
    info.className = 'cm-ySelectionInfo';
    info.textContent = this.name;
    span.appendChild(document.createTextNode('⁠'));
    span.appendChild(dot);
    span.appendChild(document.createTextNode('⁠'));
    span.appendChild(info);
    span.appendChild(document.createTextNode('⁠'));
    return span;
  }

  eq(other: NoteCaretWidget): boolean {
    return other.color === this.color && other.name === this.name;
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return -1;
  }
}

class NoteRemoteSelectionsPluginValue implements cmView.PluginValue {
  private store: NoteStore;
  decorations: cmView.DecorationSet;
  private unsub: () => void;

  constructor(view: cmView.EditorView) {
    this.store = view.state.facet(noteStoreFacet);
    this.decorations = cmState.RangeSet.of([]);
    this.unsub = this.store.subscribePresence(() => {
      view.dispatch({ annotations: [remoteSelAnnotation.of([])] });
    });
  }

  destroy(): void {
    this.unsub();
  }

  update(update: cmView.ViewUpdate): void {
    // Publish our local selection to peers.
    const hasFocus =
      update.view.hasFocus && update.view.dom.ownerDocument.hasFocus();
    const sel = hasFocus ? update.state.selection.main : null;
    if (sel) {
      this.store.setLocalSelection(sel.anchor, sel.head);
    } else {
      this.store.setLocalSelection(0, null);
    }

    // Build decorations for peer selections.
    const decorations: Array<cmState.Range<cmView.Decoration>> = [];
    const docLen = update.state.doc.length;
    for (const peer of this.store.getPeerSelections()) {
      const start = Math.min(peer.from, peer.to);
      const end = Math.max(peer.from, peer.to);
      if (start === end) {
        // caret only
      } else {
        const startLine = update.state.doc.lineAt(Math.min(start, docLen));
        const endLine = update.state.doc.lineAt(Math.min(end, docLen));
        const mark = (from: number, to: number) =>
          decorations.push({
            from,
            to,
            value: cmView.Decoration.mark({
              attributes: { style: `background-color: ${peer.color}` },
              class: 'cm-ySelection',
            }),
          });
        if (startLine.number === endLine.number) {
          mark(start, end);
        } else {
          mark(start, startLine.to);
          for (let i = startLine.number + 1; i < endLine.number; i++) {
            const line = update.state.doc.line(i);
            mark(line.from, line.to);
          }
          mark(endLine.from, end);
        }
      }
      const caretPos = Math.min(peer.to, docLen);
      decorations.push({
        from: caretPos,
        to: caretPos,
        value: cmView.Decoration.widget({
          side: peer.from - peer.to > 0 ? -1 : 1,
          block: false,
          widget: new NoteCaretWidget(peer.color, peer.name),
        }),
      });
    }
    this.decorations = cmView.Decoration.set(decorations, true);
  }
}

export const noteRemoteSelections = cmView.ViewPlugin.fromClass(
  NoteRemoteSelectionsPluginValue,
  { decorations: (v) => v.decorations },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/notes test -- remote-selection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/notes/src/view/remote-selection.ts packages/notes/src/view/remote-selection.test.ts
git commit -m "Notes: remote selection peer carets"
```

---

### Task 6: Editor `initialize()` + markdown preview + barrels

Assembles the CodeMirror EditorState (markdown lang, theme, sync + remote-selection plugins) side-by-side with a `markdown-it` preview, and returns the `NoteEditorAPI`. Fills in the public barrels.

**Files:**
- Create: `packages/notes/src/view/preview.ts`
- Create: `packages/notes/src/view/editor.ts`
- Modify: `packages/notes/src/index.ts`
- Modify: `packages/notes/src/node.ts`
- Modify: `packages/notes/package.json` (add `@types/markdown-it` dev dep)
- Test: `packages/notes/src/view/editor.test.ts`

**Interfaces:**
- Consumes: `NoteStore`, `MemNoteStore`, `noteStoreFacet`, `noteSync`, `noteRemoteSelections`, `noteRemoteSelectionsTheme`.
- Produces:
  - `type ThemeMode = 'light' | 'dark'`
  - `interface NoteEditorAPI { getText(): string; setTheme(mode: ThemeMode): void; focus(): void; dispose(): void }`
  - `function initialize(container: HTMLElement, store: NoteStore, theme?: ThemeMode, readOnly?: boolean): NoteEditorAPI`

- [ ] **Step 1: Add `@types/markdown-it`**

In `packages/notes/package.json` `devDependencies`, add:
```json
    "@types/markdown-it": "^14.1.2",
```
Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/notes/src/view/editor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MemNoteStore } from '../store/memory.js';
import { initialize } from './editor.js';

describe('initialize', () => {
  it('mounts an editor showing the store text and a rendered preview', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemNoteStore('# Title\n\nhello');
    const api = initialize(container, store, 'light');

    expect(api.getText()).toBe('# Title\n\nhello');
    // CodeMirror content is present
    expect(container.querySelector('.cm-editor')).toBeTruthy();
    // Preview rendered the heading as an <h1>
    const preview = container.querySelector('[data-role="note-preview"]');
    expect(preview?.innerHTML).toContain('<h1>');
    expect(preview?.textContent).toContain('Title');

    api.dispose();
    container.remove();
  });

  it('is read-only when requested', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const api = initialize(container, new MemNoteStore('x'), 'light', true);
    expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
    api.dispose();
    container.remove();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/notes test -- editor`
Expected: FAIL — cannot resolve `./editor.js`.

- [ ] **Step 4: Write `packages/notes/src/view/preview.ts`**

```ts
import MarkdownIt from 'markdown-it';

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

/**
 * A lightweight, framework-free markdown preview pane. Renders `markdown-it`
 * HTML into a container element on demand.
 */
export class NotePreview {
  readonly el: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.dataset.role = 'note-preview';
    this.el.className = 'note-preview markdown-body';
  }

  render(markdown: string): void {
    this.el.innerHTML = md.render(markdown);
  }
}
```

- [ ] **Step 5: Write `packages/notes/src/view/editor.ts`**

```ts
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from '@uiw/codemirror-extensions-basic-setup';
import { xcodeDark, xcodeLight } from '@uiw/codemirror-theme-xcode';
import type { NoteStore } from '../store/store.js';
import { noteStoreFacet, noteSync } from './note-sync.js';
import {
  noteRemoteSelections,
  noteRemoteSelectionsTheme,
} from './remote-selection.js';
import { NotePreview } from './preview.js';

export type ThemeMode = 'light' | 'dark';

/** Public API returned by initialize(). */
export interface NoteEditorAPI {
  /** Current markdown text. */
  getText(): string;
  /** Switch the editor color theme. */
  setTheme(mode: ThemeMode): void;
  /** Focus the editor. */
  focus(): void;
  /** Tear down the editor and its listeners. */
  dispose(): void;
}

/**
 * Mount a collaborative markdown editor into `container`.
 *
 * Left pane: CodeMirror markdown source, synced to `store` (local edits →
 * store.editText; remote changes → CM transactions). Right pane: live
 * markdown preview re-rendered from the editor content on every change
 * (so both local and remote edits reflect).
 */
export function initialize(
  container: HTMLElement,
  store: NoteStore,
  theme: ThemeMode = 'light',
  readOnly = false,
): NoteEditorAPI {
  container.style.display = 'flex';
  container.style.alignItems = 'stretch';
  container.style.height = '100%';

  const editorEl = document.createElement('div');
  editorEl.dataset.role = 'note-editor';
  editorEl.style.flex = '1 1 50%';
  editorEl.style.overflow = 'auto';
  editorEl.style.minWidth = '0';

  const preview = new NotePreview();
  preview.el.style.flex = '1 1 50%';
  preview.el.style.overflow = 'auto';
  preview.el.style.padding = '0 16px';
  preview.el.style.minWidth = '0';

  container.appendChild(editorEl);
  container.appendChild(preview.el);

  const themeExt = (mode: ThemeMode) =>
    mode === 'light' ? xcodeLight : xcodeDark;

  const themeCompartmentDoc = () => view.state.doc.toString();
  const renderPreview = () => preview.render(themeCompartmentDoc());

  const state = EditorState.create({
    doc: store.getText(),
    extensions: [
      basicSetup({ highlightSelectionMatches: false }),
      markdown(),
      themeExt(theme),
      EditorView.lineWrapping,
      EditorView.editable.of(!readOnly),
      EditorView.theme({ '&': { width: '100%' } }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) renderPreview();
      }),
      noteStoreFacet.of(store),
      noteSync,
      noteRemoteSelectionsTheme,
      noteRemoteSelections,
    ],
  });

  const view = new EditorView({ state, parent: editorEl });
  renderPreview();

  let currentTheme = theme;

  return {
    getText: () => view.state.doc.toString(),
    setTheme: (mode: ThemeMode) => {
      if (mode === currentTheme) return;
      currentTheme = mode;
      // Rebuild state to swap the (non-compartmentalized) theme extension.
      // Simplicity over a Compartment: notes have a single theme extension.
      const doc = view.state.doc.toString();
      const sel = view.state.selection;
      view.setState(
        EditorState.create({
          doc,
          selection: sel,
          extensions: [
            basicSetup({ highlightSelectionMatches: false }),
            markdown(),
            themeExt(mode),
            EditorView.lineWrapping,
            EditorView.editable.of(!readOnly),
            EditorView.theme({ '&': { width: '100%' } }),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) renderPreview();
            }),
            noteStoreFacet.of(store),
            noteSync,
            noteRemoteSelectionsTheme,
            noteRemoteSelections,
          ],
        }),
      );
      renderPreview();
    },
    focus: () => view.focus(),
    dispose: () => view.destroy(),
  };
}
```

Note: `setTheme` rebuilds state for simplicity (notes have exactly one theme extension and no undo-history-preservation requirement across theme toggles beyond content+selection, both carried over). If a reviewer prefers a `Compartment`, that is an acceptable refactor but not required for P1.

- [ ] **Step 6: Fill `packages/notes/src/index.ts` (browser barrel)**

```ts
// Store
export type {
  NoteStore,
  NoteTextChange,
  NoteRemoteChange,
  NotePeerSelection,
} from './store/store.js';
export { MemNoteStore } from './store/memory.js';
export type { Unsubscribe } from './types.js';

// View
export { initialize, type NoteEditorAPI, type ThemeMode } from './view/editor.js';
export { noteStoreFacet, noteSync } from './view/note-sync.js';
export {
  noteRemoteSelections,
  noteRemoteSelectionsTheme,
} from './view/remote-selection.js';
```

- [ ] **Step 7: Fill `packages/notes/src/node.ts` (DOM-free barrel)**

```ts
// DOM-free public surface for @wafflebase/notes.
// A note's content IS its markdown string, so the Node surface is just the
// store contract + the in-memory store. No view/ (DOM) modules here.
export type {
  NoteStore,
  NoteTextChange,
  NoteRemoteChange,
  NotePeerSelection,
} from './store/store.js';
export { MemNoteStore } from './store/memory.js';
export type { Unsubscribe } from './types.js';
```

- [ ] **Step 8: Run test + build**

Run: `pnpm --filter @wafflebase/notes test -- editor`
Expected: PASS (2 tests).
Run: `pnpm --filter @wafflebase/notes build && pnpm --filter @wafflebase/notes typecheck`
Expected: build emits `dist/`, typecheck passes.

- [ ] **Step 9: Commit**

```bash
git add packages/notes/src/view/preview.ts packages/notes/src/view/editor.ts packages/notes/src/index.ts packages/notes/src/node.ts packages/notes/src/view/editor.test.ts packages/notes/package.json pnpm-lock.yaml
git commit -m "Notes: editor initialize() + markdown preview + barrels"
```

---

### Task 7: Wire the engine into the frontend build

Register `@wafflebase/notes` as a frontend dependency + Vite alias so frontend code can import the engine from source (matching how `@wafflebase/docs` is wired).

**Files:**
- Modify: `packages/frontend/package.json` (dependencies)
- Modify: `packages/frontend/vite.config.ts` (resolve.alias)

**Interfaces:**
- Produces: `import { initialize } from '@wafflebase/notes'` resolves to `../notes/src/index.ts` in the frontend.

- [ ] **Step 1: Add the dependency**

In `packages/frontend/package.json`, in `dependencies` next to the other `@wafflebase/*` lines:
```json
    "@wafflebase/notes": "workspace:*",
```

- [ ] **Step 2: Add the Vite alias**

In `packages/frontend/vite.config.ts`, in the `resolve.alias` block after the `@wafflebase/docs` alias:
```ts
      "@wafflebase/notes": path.resolve(__dirname, "../notes/src/index.ts"),
```

- [ ] **Step 3: Install + typecheck**

Run: `pnpm install && pnpm --filter @wafflebase/frontend typecheck`
Expected: install links the dep; typecheck passes (nothing imports it yet).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/package.json packages/frontend/vite.config.ts pnpm-lock.yaml
git commit -m "Notes: wire @wafflebase/notes into frontend build"
```

---

### Task 8: Frontend Yorkie root + presence types

Defines the Yorkie document root (`{ content: Text }`) + presence shape + `initialNotesRoot()`. Frozen schema — byte-compatible with CodePair.

**Files:**
- Create: `packages/frontend/src/types/notes-document.ts`
- Test: `packages/frontend/src/types/notes-document.test.ts`

**Interfaces:**
- Produces:
  - `type YorkieNotesRoot = { content: Text }`
  - `type NotesPresence = { username: string; email: string; photo: string; color: string; name: string; selection: TextPosStructRange | null; cursor: [number, number] | null }`
  - `function initialNotesRoot(): Partial<YorkieNotesRoot>`

- [ ] **Step 1: Write the failing test**

`packages/frontend/src/types/notes-document.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Text } from '@yorkie-js/sdk';
import { initialNotesRoot } from './notes-document';

describe('initialNotesRoot', () => {
  it('creates a Text content field for client.attach to seed', () => {
    const root = initialNotesRoot();
    // NOTE: a detached yorkie.Text throws ErrNotInitialized if you call its
    // methods (edit/toString) before client.attach seeds it inside a doc.
    // So assert the instance, do NOT call .toString() here (verified in the
    // Task 2 spike). The real content round-trip is covered by the
    // YorkieNoteStore test (Task 9), which drives an attached Document.
    expect(root.content).toBeInstanceOf(Text);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- notes-document`
Expected: FAIL — cannot resolve `./notes-document`.

- [ ] **Step 3: Write `packages/frontend/src/types/notes-document.ts`**

```ts
import { Text } from '@yorkie-js/sdk';
import type { TextPosStructRange } from '@yorkie-js/sdk';

/**
 * Yorkie document root for a markdown note.
 *
 * The whole note is a single `yorkie.Text` CRDT at `content` — byte-compatible
 * with CodePair, so a future migration (P3) is a re-key, not a conversion.
 * Do NOT add fields to this root without treating it as a migration event.
 */
export type YorkieNotesRoot = {
  content: Text;
};

/**
 * Presence for a note editor. `username`/`email`/`photo` feed the shared
 * UserPresence avatar chrome; `color`/`name`/`selection`/`cursor` drive the
 * CodeMirror peer carets (ported from CodePair). The store updates only
 * `selection`/`cursor` via a partial `presence.set`, so the identity fields
 * set at attach time persist.
 */
export type NotesPresence = {
  username: string;
  email: string;
  photo: string;
  color: string;
  name: string;
  selection: TextPosStructRange | null;
  cursor: [number, number] | null;
};

/**
 * Initial Yorkie root for a new note. Creating the Text here means
 * `client.attach({ initialRoot })` seeds it inside the SDK and clears the
 * undo stack right after.
 */
export function initialNotesRoot(): Partial<YorkieNotesRoot> {
  return {
    content: new Text(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- notes-document`
Expected: PASS — `root.content` is a `Text` instance. (Do NOT call `.toString()` on the detached Text; it throws `ErrNotInitialized`.)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/types/notes-document.ts packages/frontend/src/types/notes-document.test.ts
git commit -m "Notes: Yorkie root + presence types (frontend)"
```

---

### Task 9: `YorkieNoteStore` (frontend Yorkie-backed NoteStore)

Implements `NoteStore` over the Yorkie `Text` CRDT + presence. This is where CodePair's `yorkieSync`/`remoteSelection` CRDT logic lands (op translation, posRange conversions).

**Files:**
- Create: `packages/frontend/src/app/notes/yorkie-note-store.ts`
- Test: `packages/frontend/src/app/notes/yorkie-note-store.test.ts`

**Interfaces:**
- Consumes: `NoteStore`, `NotePeerSelection`, `NoteRemoteChange`, `Unsubscribe` from `@wafflebase/notes`; `YorkieNotesRoot`, `NotesPresence` from `@/types/notes-document`.
- Produces: `class YorkieNoteStore implements NoteStore` (constructor `(doc: Document<YorkieNotesRoot, NotesPresence>)`).

- [ ] **Step 1: Write the failing test** (drives a real in-process Yorkie Document — no server needed for local ops)

`packages/frontend/src/app/notes/yorkie-note-store.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Document, Text } from '@yorkie-js/sdk';
import { YorkieNoteStore } from './yorkie-note-store';
import type { YorkieNotesRoot, NotesPresence } from '@/types/notes-document';

function makeDoc(): Document<YorkieNotesRoot, NotesPresence> {
  const doc = new Document<YorkieNotesRoot, NotesPresence>('note-test');
  doc.update((root) => {
    root.content = new Text();
    root.content.edit(0, 0, 'hello');
  });
  return doc;
}

describe('YorkieNoteStore', () => {
  it('reads text from the Yorkie Text', () => {
    const store = new YorkieNoteStore(makeDoc());
    expect(store.getText()).toBe('hello');
  });

  it('applies a local edit into the Yorkie Text', () => {
    const store = new YorkieNoteStore(makeDoc());
    store.editText(5, 5, ' world');
    expect(store.getText()).toBe('hello world');
  });

  it('has no peer selections for a single client', () => {
    const store = new YorkieNoteStore(makeDoc());
    expect(store.getPeerSelections()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- yorkie-note-store`
Expected: FAIL — cannot resolve `./yorkie-note-store`.

- [ ] **Step 3: Write `packages/frontend/src/app/notes/yorkie-note-store.ts`**

```ts
import type { Document } from '@yorkie-js/sdk';
import type {
  NoteStore,
  NotePeerSelection,
  NoteRemoteChange,
  Unsubscribe,
} from '@wafflebase/notes';
import type { YorkieNotesRoot, NotesPresence } from '@/types/notes-document';

/**
 * Yorkie-backed NoteStore. Holds the note's markdown in a single `Text` CRDT
 * at `root.content` and drives peer carets through Yorkie presence. Ported
 * from CodePair's yorkieSync/remoteSelection, relocated behind NoteStore so
 * the engine stays CRDT-agnostic (project Store rule).
 */
export class YorkieNoteStore implements NoteStore {
  constructor(private readonly doc: Document<YorkieNotesRoot, NotesPresence>) {}

  getText(): string {
    const content = this.doc.getRoot().content;
    return content ? content.toString() : '';
  }

  editText(from: number, to: number, insert: string): void {
    this.doc.update((root) => {
      root.content.edit(from, to, insert);
    });
  }

  subscribeRemote(listener: (change: NoteRemoteChange) => void): Unsubscribe {
    return this.doc.subscribe((event) => {
      if (event.type === 'snapshot') {
        listener({ type: 'replace', content: this.getText() });
        return;
      }
      const isUndoRedo =
        event.type === 'local-change' && event.source === 'undoredo';
      if (event.type !== 'remote-change' && !isUndoRedo) return;

      const { operations } = event.value;
      // Whole `content` object replaced → full reload.
      const contentReplaced = operations.some(
        (op) => op.type === 'remove' && op.path === '$',
      );
      if (contentReplaced) {
        listener({ type: 'replace', content: this.getText() });
        return;
      }
      for (const op of operations) {
        if (op.type === 'edit' && op.path?.startsWith('$.content')) {
          listener({
            type: 'edits',
            changes: [
              {
                from: Math.max(0, op.from),
                to: Math.max(0, op.to),
                insert: op.value?.content ?? '',
              },
            ],
          });
        }
      }
    });
  }

  setLocalSelection(anchor: number, head: number | null): void {
    this.doc.update((root, presence) => {
      const content = root.content;
      if (head === null || !content) {
        if (presence.get('selection')) {
          presence.set({ selection: null, cursor: null });
        }
        return;
      }
      const selection = content.indexRangeToPosRange([anchor, head]);
      const cursor = content.posRangeToIndexRange(selection);
      const prev = presence.get('selection');
      if (JSON.stringify(prev) !== JSON.stringify(selection)) {
        presence.set({ selection, cursor });
      }
    });
  }

  getPeerSelections(): NotePeerSelection[] {
    const content = this.doc.getRoot().content;
    if (!content) return [];
    const result: NotePeerSelection[] = [];
    for (const peer of this.doc.getOthersPresences()) {
      const sel = peer.presence.selection;
      if (!sel) continue;
      const [from, to] = content.posRangeToIndexRange(sel);
      result.push({
        clientID: String(peer.clientID),
        from,
        to,
        color: peer.presence.color,
        name: peer.presence.name,
      });
    }
    return result;
  }

  subscribePresence(listener: () => void): Unsubscribe {
    return this.doc.subscribe('others', () => {
      listener();
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- yorkie-note-store`
Expected: PASS (3 tests). If TypeScript complains about `op.value?.content` typing, cast via `(op.value as { content?: string } | undefined)?.content` — the op union in 0.7.8 may type `value` loosely.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/notes/yorkie-note-store.ts packages/frontend/src/app/notes/yorkie-note-store.test.ts
git commit -m "Notes: YorkieNoteStore (frontend Yorkie-backed store)"
```

---

### Task 10: `NotesView` (mount the engine)

Thin React component: builds `YorkieNoteStore` from `useDocument()`, calls `initialize()`, syncs theme, disposes on unmount. Remote changes + peer carets are handled inside the engine (via the store), so no re-render plumbing is needed — much simpler than `DocsView`.

**Files:**
- Create: `packages/frontend/src/app/notes/notes-view.tsx`

**Interfaces:**
- Consumes: `initialize`, `NoteEditorAPI`, `ThemeMode` from `@wafflebase/notes`; `YorkieNoteStore` (Task 9); `YorkieNotesRoot`, `NotesPresence` (Task 8); `useDocument` (`@yorkie-js/react`), `useTheme` (`@/components/theme-provider`), `Loader`.
- Produces: `export function NotesView(props: { onEditorReady?: (e: NoteEditorAPI | null) => void; readOnly?: boolean })`.

- [ ] **Step 1: Write `packages/frontend/src/app/notes/notes-view.tsx`**

```tsx
import { initialize, type NoteEditorAPI, type ThemeMode } from "@wafflebase/notes";
import { useEffect, useRef, useState } from "react";
import { useDocument } from "@yorkie-js/react";
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import type { YorkieNotesRoot, NotesPresence } from "@/types/notes-document";
import { YorkieNoteStore } from "./yorkie-note-store";

export type { NoteEditorAPI } from "@wafflebase/notes";

interface NotesViewProps {
  onEditorReady?: (editor: NoteEditorAPI | null) => void;
  readOnly?: boolean;
}

export function NotesView({ onEditorReady, readOnly }: NotesViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NoteEditorAPI | null>(null);
  const [didMount, setDidMount] = useState(false);
  const { doc, loading, error } = useDocument<YorkieNotesRoot, NotesPresence>();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container || !doc) return;

    const store = new YorkieNoteStore(doc);
    const theme = (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode;
    const editor = initialize(container, store, theme, readOnly);
    editorRef.current = editor;
    onEditorReady?.(editor);

    return () => {
      editor.dispose();
      editorRef.current = null;
      onEditorReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didMount, doc]);

  useEffect(() => {
    editorRef.current?.setTheme(
      (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode,
    );
  }, [resolvedTheme]);

  if (loading) return <Loader />;
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Failed to load note.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 w-full min-h-0 overflow-hidden"
    />
  );
}

export default NotesView;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @wafflebase/frontend typecheck`
Expected: PASS. (If `useTheme`'s import path differs, confirm against `packages/frontend/src/app/docs/docs-view.tsx` which imports `useTheme` from `@/components/theme-provider`.)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/notes/notes-view.tsx
git commit -m "Notes: NotesView mounts the engine"
```

---

### Task 11: `NotesDetail` (route component + chrome)

Wraps `NotesView` with the app sidebar/header chrome and the Yorkie `DocumentProvider` (docKey `note-<id>`, `initialNotesRoot()`, presence). Mirrors `docs-detail.tsx` minus docs-only features (comments toggle, export button).

**Files:**
- Create: `packages/frontend/src/app/notes/notes-detail.tsx`

**Interfaces:**
- Consumes: `DocumentProvider`, `useDocument` (`@yorkie-js/react`); `NotesView` (Task 10); `initialNotesRoot`, `YorkieNotesRoot` (Task 8); chrome (`AppSidebar`, `SiteHeader`, `ShareDialog`, `UserPresence`, sidebar primitives); data hooks (`fetchMe`, `fetchDocument`, `renameDocument`, `fetchWorkspaces`).
- Produces: `export function NotesDetail()` (default export) — the `/n/:id` route element.

- [ ] **Step 1: Write `packages/frontend/src/app/notes/notes-detail.tsx`**

Clone `packages/frontend/src/app/docs/docs-detail.tsx` with these deltas:
- Rename `DocsLayout` → `NotesLayout`, `DocsDetail` → `NotesDetail`.
- Remove: `usePresenceUpdater()` call, the comments `Toggle`/state, `DocsExportButton`, `DocsFormattingToolbar`, `editContext` state, `JumpHandle`/`jumpToPeer` wiring, and the `getJumpHint`/`handleSelectPeer` peer-jump logic (notes peer carets live in the editor, not surfaced in the avatar chrome for P1 — `UserPresence` renders avatars only).
- Replace the editor body with `<NotesView />`.
- Change the provider `docKey` to `note-${id}` and `initialRoot` to `initialNotesRoot()`.

Full file:
```tsx
import { DocumentProvider } from "@yorkie-js/react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { fetchMe } from "@/api/auth";
import { fetchDocument, renameDocument } from "@/api/documents";
import { toast } from "sonner";
import { Loader } from "@/components/loader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { ShareDialog } from "@/components/share-dialog";
import { UserPresence } from "@/components/user-presence";
import { IconFolder, IconSettings, IconDatabase } from "@tabler/icons-react";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { initialNotesRoot } from "@/types/notes-document";
import { NotesView } from "./notes-view";

function NotesLayout({ documentId }: { documentId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: documentData, isError: isDocumentError } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    retry: false,
  });

  useEffect(() => {
    document.title = documentData?.title
      ? `${documentData.title} — Wafflebase`
      : "Wafflebase";
  }, [documentData?.title]);

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  const currentWorkspace = workspaces.find(
    (w) => w.id === documentData?.workspaceId,
  );
  const workspaceSlug = currentWorkspace?.slug;
  const fallbackSlug = workspaceSlug ?? workspaces[0]?.slug;

  useEffect(() => {
    if (isDocumentError) {
      toast.error("Document not found");
      navigate(fallbackSlug ? `/w/${fallbackSlug}` : "/documents", {
        replace: true,
      });
    }
  }, [isDocumentError, navigate, fallbackSlug]);

  const items = useMemo(() => {
    if (workspaceSlug) {
      return {
        main: [
          { title: "Documents", url: `/w/${workspaceSlug}`, icon: IconFolder },
          { title: "Data Sources", url: `/w/${workspaceSlug}/datasources`, icon: IconDatabase },
          { title: "Settings", url: `/w/${workspaceSlug}/settings`, icon: IconSettings },
        ],
        secondary: [],
      };
    }
    return {
      main: [
        { title: "Documents", url: "/documents", icon: IconFolder },
        { title: "Data Sources", url: "/datasources", icon: IconDatabase },
        { title: "Settings", url: "/settings", icon: IconSettings },
      ],
      secondary: [],
    };
  }, [workspaceSlug]);

  const handleWorkspaceChange = useCallback(
    (slug: string) => {
      navigate(`/w/${slug}`);
    },
    [navigate],
  );

  const handleRenameDocument = useCallback(
    async (newTitle: string) => {
      await renameDocument(documentId, newTitle);
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    [documentId, queryClient],
  );

  return (
    <SidebarProvider>
      <AppSidebar
        variant="inset"
        items={items}
        workspaces={workspaces}
        currentWorkspace={currentWorkspace}
        onWorkspaceChange={handleWorkspaceChange}
      />
      <SidebarInset>
        <SiteHeader
          title={documentData?.title ?? "Loading..."}
          editable
          onRename={handleRenameDocument}
        >
          <div className="flex items-center gap-2">
            <ShareDialog documentId={documentId} />
            <UserPresence />
          </div>
        </SiteHeader>
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <NotesView />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function NotesDetail() {
  const { id } = useParams();

  const {
    data: currentUser,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Loader />;
  if (isError || !currentUser) return <Navigate to="/login" replace />;
  if (!currentUser.username || !currentUser.email) return <Loader />;

  return (
    <DocumentProvider
      docKey={`note-${id}`}
      initialRoot={initialNotesRoot()}
      initialPresence={{
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo || "",
        color: "#1E88E5",
        name: currentUser.username,
        selection: null,
        cursor: null,
      }}
      enableDevtools={import.meta.env.DEV}
    >
      <NotesLayout documentId={id!} />
    </DocumentProvider>
  );
}

export default NotesDetail;
```

Note: `UserPresence` is used without the peer-jump props (they are optional in docs usage — confirm the component's props allow omission; if `onSelectPeer`/`getJumpHint` are required, pass `onSelectPeer={() => {}}` and `getJumpHint={() => undefined}`). The presence `color` is a fixed blue for P1 (CodePair randomized per client; a fixed color is acceptable — peer carets still differ by name. A random per-client color is a trivial P2 polish).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @wafflebase/frontend typecheck`
Expected: PASS. Resolve any `UserPresence`/`SiteHeader` prop mismatches by matching `docs-detail.tsx` usage exactly.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/notes/notes-detail.tsx
git commit -m "Notes: NotesDetail route component + chrome"
```

---

### Task 12: Type touchpoints — union, route, path, create button

Wires `note` into the frontend type system, router, path resolver, and the "New" menu so users can create and open notes.

**Files:**
- Modify: `packages/frontend/src/types/documents.ts`
- Modify: `packages/frontend/src/app/documents/document-list-utils.ts`
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/app/documents/document-list.tsx`

**Interfaces:**
- Consumes: `NotesDetail` (Task 11), `getDocumentPath`, `createDocumentMutation` (existing).
- Produces: `/n/:id` route; `getDocumentPath({type:'note'})==='/n/<id>'`; a "New Note" menu item creating `{ type: 'note' }`.

- [ ] **Step 1: Extend the `DocumentType` union**

In `packages/frontend/src/types/documents.ts`:
```ts
export type DocumentType = "sheet" | "doc" | "slides" | "pdf" | "note";
```

- [ ] **Step 2: Add the path case**

In `packages/frontend/src/app/documents/document-list-utils.ts`, in `getDocumentPath`'s switch, before `case "sheet":`:
```ts
    case "note":
      return `/n/${doc.id}`;
```

- [ ] **Step 3: Add the lazy route**

In `packages/frontend/src/App.tsx`, with the other detail lazy imports:
```tsx
const NotesDetail = lazy(() => import("@/app/notes/notes-detail"));
```
In the routes block, after the `/f/:id` route:
```tsx
                  <Route path="/n/:id" element={<NotesDetail />} />
```

- [ ] **Step 4: Add the "New Note" menu item**

In `packages/frontend/src/app/documents/document-list.tsx`, add a `DropdownMenuItem` alongside the other "New …" items (e.g. after "New Document"):
```tsx
            <DropdownMenuItem
              onClick={() =>
                createDocumentMutation.mutate({
                  title: "New Note",
                  type: "note",
                })
              }
            >
              <FileText className="mr-2 h-4 w-4 text-purple-500" />
              New Note
            </DropdownMenuItem>
```
(Use an already-imported lucide icon; `FileText` is imported for "New Document". If you want a distinct icon, import `NotebookPen` from `lucide-react` and use it here.)

If there is a `DOC_TYPE_META` map and a type-chip list in this file (used for the list's type filter chips), add a `note` entry mirroring the `doc` entry:
```ts
  note: { label: "Note", Icon: FileText, color: "text-purple-500" },
```
and include `"note"` in the chip-type array so notes are filterable.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @wafflebase/frontend typecheck && pnpm --filter @wafflebase/frontend lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/types/documents.ts packages/frontend/src/app/documents/document-list-utils.ts packages/frontend/src/App.tsx packages/frontend/src/app/documents/document-list.tsx
git commit -m "Notes: wire note type into union, route, path, create menu"
```

---

### Task 13: Shared read-only notes (share links)

Adds the `note` branch to the shared-document viewer so share links to notes render a read-only editor. Sharing/auth already works via the `note-` docKey; this only adds the editor branch.

**Files:**
- Modify: `packages/frontend/src/app/shared/shared-document.tsx`

**Interfaces:**
- Consumes: `NotesView` (with `readOnly`), `initialNotesRoot`, `YorkieNotesRoot` (Task 8/10), `DocumentProvider`.
- Produces: a `SharedNotesLayout` and a `resolved.type === "note"` branch mounting it.

- [ ] **Step 1: Add a `SharedNotesLayout`**

In `packages/frontend/src/app/shared/shared-document.tsx`, near the existing `SharedDocsLayout` (imported/defined for docs), add a minimal layout that renders the read-only notes editor:
```tsx
function SharedNotesLayout({
  resolved,
}: {
  resolved: { documentId: string; title?: string };
}) {
  useEffect(() => {
    document.title = resolved.title
      ? `${resolved.title} — Wafflebase`
      : "Wafflebase";
  }, [resolved.title]);
  return (
    <div className="flex h-screen w-full flex-col">
      <NotesView readOnly />
    </div>
  );
}
```
Add the imports at the top:
```tsx
import { NotesView } from "@/app/notes/notes-view";
import { initialNotesRoot, type YorkieNotesRoot } from "@/types/notes-document";
```
(Match the exact shape of `resolved` used by the sibling layouts in this file; if `SharedDocsLayout` receives a richer `resolved` object, use the same type.)

- [ ] **Step 2: Extend the docKey derivation**

In the `docKey` computation, add the `note` case:
```tsx
  const docKey =
    resolved.type === "doc"
      ? `doc-${resolved.documentId}`
      : resolved.type === "slides"
      ? `slides-${resolved.documentId}`
      : resolved.type === "note"
      ? `note-${resolved.documentId}`
      : `sheet-${resolved.documentId}`;
```

- [ ] **Step 3: Add the provider branch**

In the editor-by-type JSX, add a branch before the final `sheet` fallback:
```tsx
      ) : resolved.type === "note" ? (
        <DocumentProvider<Partial<YorkieNotesRoot>>
          docKey={docKey}
          initialRoot={initialNotesRoot()}
          initialPresence={presence}
          enableDevtools={import.meta.env.DEV}
        >
          <SharedNotesLayout resolved={resolved} />
        </DocumentProvider>
```
(Use the same `presence` object the sibling branches pass. If the shared presence shape lacks `color`/`name`/`selection`/`cursor`, that is fine for read-only viewing — the reader publishes no selection; peer carets from editors still render because `getPeerSelections` only reads *others'* presence.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @wafflebase/frontend typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/shared/shared-document.tsx
git commit -m "Notes: read-only shared note viewer"
```

---

### Task 14: Full verification + manual smoke

Run the pre-commit gate across the whole repo, then a manual collaborative smoke test.

**Files:** `package.json` (root — wire the notes package into the gate).

- [ ] **Step 0: Wire `@wafflebase/notes` into the root gate**

The root `verify:fast` and `test` scripts enumerate packages explicitly and do
NOT yet include `@wafflebase/notes` — so the engine's tests/typecheck never run
in the pre-commit gate. In the root `package.json`:
- In `verify:fast`, append ` && pnpm --filter @wafflebase/notes typecheck && pnpm --filter @wafflebase/notes test` after the `@wafflebase/docs` entries.
- In the root `test` script's `concurrently` list, add `"pnpm --filter @wafflebase/notes test"`.
Commit this wiring:
```bash
git add package.json
git commit -m "Notes: wire @wafflebase/notes into root verify:fast + test"
```

- [ ] **Step 1: Run the fast gate**

Run: `pnpm verify:fast`
Expected: lint + unit tests pass across all packages (now including the
`@wafflebase/notes` suite via Step 0, plus the frontend/backend additions).
Note: the frontend has NO `typecheck` script — its gate is `pnpm frontend lint`
(eslint `--max-warnings 0`) + `pnpm frontend test`. Frontend type/compile errors
surface via `pnpm --filter @wafflebase/frontend build` and lint, not a raw
`tsc --noEmit` (the repo carries baseline `tsc` noise on the app tsconfig).

- [ ] **Step 2: Build all**

Run: `pnpm --filter @wafflebase/notes build && pnpm --filter @wafflebase/frontend build`
Expected: both build. Watch the frontend chunk-gate — the notes route is lazy, so CodeMirror + markdown-it land in a `/n/:id` chunk, not the main bundle. If the gate trips, confirm the notes chunk is separate (lazy import in `App.tsx`); adjust `FRONTEND_CHUNK_LIMIT_KB` only if a reviewer agrees.

- [ ] **Step 3: Manual smoke (two browsers)**

Run: `docker compose up -d && pnpm dev`
Then, as the checklist:
  - [ ] Documents list → "New Note" → redirects to `/n/<id>`.
  - [ ] Type markdown (`# Title`, `- list`, `**bold**`); the right preview updates live.
  - [ ] Open the same `/n/<id>` in a second browser/profile; edits from A appear in B and vice-versa (single `Text` CRDT sync).
  - [ ] A peer caret with the other user's name renders at their cursor; selecting text shows a colored peer selection.
  - [ ] Reload → content persists (Yorkie snapshot restores; `type: 'replace'` path).
  - [ ] Create a share link (viewer role) → open in a logged-out window → note renders read-only (no typing), remote edits still stream in.
  - [ ] Rename via the header → documents list reflects the new title.
  - [ ] Toggle app theme → editor + preview restyle.

- [ ] **Step 4: Capture lessons + finalize**

Fill in `docs/tasks/active/20260715-notes-markdown-type-lessons.md` (created alongside this plan) with anything non-obvious discovered (0.7.8 API deltas, presence merge behavior, chunk-gate outcome). Then:
```bash
git add docs/tasks/active/20260715-notes-markdown-type-lessons.md
git commit -m "Notes: capture P1 implementation lessons"
```

- [ ] **Step 5: Self-review before PR**

Dispatch a code-review skill (e.g. `/code-review`) over the full branch diff. Apply blocking findings; note non-blocking as known limitations. Then `git fetch && git rebase origin/main`, push, and open the PR (Title ≤70 chars; body = Summary + Test plan).

---

## Review

**Status:** P1 implemented via subagent-driven execution (14 tasks, fresh
implementer + spec/quality review per task, opus whole-branch review at the
end). All automated gates green: `pnpm verify:fast` passes (now includes the
`@wafflebase/notes` typecheck + 13 tests, wired in Task 14 Step 0); frontend +
notes builds succeed. **Not yet run:** the interactive two-browser
collaborative + share-link smoke (Task 14 Step 3) — needs a live `pnpm dev`
environment.

**What shipped (branch `feat/notes-markdown-type`, 22 commits):**
- Engine `@wafflebase/notes`: `NoteStore`/`MemNoteStore`, CodeMirror↔store sync
  binding (echo-suppressed, offset-adjusted), remote-selection peer carets
  (clamped, multi-line), `initialize()` + markdown-it preview, dual `.`/`./node`
  barrels. Framework-agnostic — zero `@yorkie-js/*` imports (Store rule holds).
- Frontend: `YorkieNoteStore` (Yorkie Text + presence, CodePair port behind the
  interface), `NotesView`/`NotesDetail`, Yorkie root/presence types, type/route/
  create-menu wiring, read-only shared viewer.
- Backend: `note` type + `note-` docKey prefix — inherits auth/edit webhooks +
  sharing unchanged.

**Deviations from plan (all reviewed/ratified):**
- Test binding: CM `ViewPlugin` builds decorations in the constructor too, not
  only `update()` (mount-time carets). See lessons.
- Frontend test discovery: Vitest `include` glob widened to `src/**` so the
  co-located tests run; surfaced + fixed a dormant `theme-fonts.test.ts`
  (Fraunces font). See lessons.
- Plan gaps fixed mid-flight: `ResolvedShareLink.type` widened to include
  `note`; `@wafflebase/notes` wired into root `verify:fast`/`test`; frontend
  has no `typecheck` script (gate = lint + build). See lessons.
- Final review fix: shared-link peer-caret presence was missing `color`/`name`
  (invisible carets) — added `noteUserColor()` deterministic per-user color used
  by both owner and shared routes.

**Follow-ups deferred:**
- REST API v1 `create` coerces `type:'note'`→`'sheet'` (pre-existing pattern,
  also drops `pdf`); v1 API is spreadsheet-oriented (no note cells/tabs). Fast-
  follow, out of P1 scope.
- `notes-detail.tsx` dropped the mobile Radix-Sheet `pointer-events` cleanup
  effect docs-detail has (edge-case mobile nav). Minor parity gap.
- Bundle: the `/n/:id` chunk is ~723 kB (259 kB gzip: CodeMirror + markdown-it),
  lazy-loaded and isolated from the main bundle. Trim in P2 if needed.
- P2 (feature parity): image upload, PDF/HTML/MD export, revision history, vim.
- P3 (CodePair migration) and the two open questions (CodePair prod data?
  shared Yorkie server/project?).
