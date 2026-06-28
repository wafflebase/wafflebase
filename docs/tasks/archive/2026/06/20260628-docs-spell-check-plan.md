# Docs Spell Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Red squiggle under misspelled English words in the Docs editor, with a right-click popover of suggestions that replace the word as one undoable edit.

**Architecture:** A self-contained `packages/docs/src/spell/` module (interface + providers + router + tokenizer + view-local session), decoupled from rendering. Misspelled ranges are computed view-side and drawn by mirroring the existing search/comment highlight path (`computeSelectionRects` → new `render()` param → squiggle draw). Replacement reuses the `Doc` delete+insert path that `FindReplaceState` uses.

**Tech Stack:** TypeScript, Vitest, `nspell` + `dictionary-en` (lazy dynamic import), Canvas 2D.

## Global Constraints

- Spell state is **view-local** — never written to the Yorkie/CRDT document (mirror `FindReplaceState`, which takes a `Doc` + `snapshot` and only calls text mutations).
- All text mutations go through `Doc`: `doc.deleteText({blockId, offset}, length)` then `doc.insertText({blockId, offset}, text)`, preceded by `snapshot()` for a single undo unit.
- New modules live under `packages/docs/src/spell/`. Tests under `packages/docs/test/spell/`. Use `.js` import specifiers (project uses NodeNext ESM: imports end in `.js`).
- Provider methods are async (`Promise`) so backend and local share one shape.
- Skip rules (never flag): IME composition, the word under the caret until the caret leaves it, pure numbers, URLs, emails, all-caps acronyms (len ≥ 2), tokens < 2 chars, CJK words. Hangul words route to a provider that is absent in v1 → un-flagged.
- Test command: `pnpm --filter @wafflebase/docs test run <path>`. Pre-commit gate: `pnpm verify:fast`.
- Commit format: subject ≤70 chars, blank line 2, body explains why; end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Script classifier + SpellChecker interface

**Files:**
- Create: `packages/docs/src/spell/spell-checker.ts`
- Test: `packages/docs/test/spell/spell-checker.test.ts`

**Interfaces:**
- Produces:
  - `type Lang = 'en' | 'ko' | 'skip'`
  - `type Script = 'latin' | 'hangul' | 'cjk' | 'other'`
  - `function scriptOf(word: string): Script`
  - `function langForScript(script: Script): Lang`
  - `interface SpellChecker { check(word: string, lang: Lang): Promise<boolean>; suggest(word: string, lang: Lang): Promise<string[]>; supports(lang: Lang): boolean; }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/docs/test/spell/spell-checker.test.ts
import { describe, it, expect } from 'vitest';
import { scriptOf, langForScript } from '../../src/spell/spell-checker.js';

describe('scriptOf', () => {
  it('classifies plain ASCII as latin', () => {
    expect(scriptOf('hello')).toBe('latin');
  });
  it('classifies accented Latin as latin', () => {
    expect(scriptOf('café')).toBe('latin');
  });
  it('classifies Hangul syllables as hangul', () => {
    expect(scriptOf('안녕')).toBe('hangul');
  });
  it('classifies Han/Kana as cjk', () => {
    expect(scriptOf('日本')).toBe('cjk');
    expect(scriptOf('こんにちは')).toBe('cjk');
  });
  it('uses the dominant script for mixed words', () => {
    expect(scriptOf('test안녕')).toBe('latin'); // 4 latin vs 2 hangul
  });
});

describe('langForScript', () => {
  it('maps scripts to langs', () => {
    expect(langForScript('latin')).toBe('en');
    expect(langForScript('hangul')).toBe('ko');
    expect(langForScript('cjk')).toBe('skip');
    expect(langForScript('other')).toBe('skip');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs test run test/spell/spell-checker.test.ts`
Expected: FAIL — cannot find module `spell-checker.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/docs/src/spell/spell-checker.ts

/** Language tag a provider handles. 'skip' means "do not check". */
export type Lang = 'en' | 'ko' | 'skip';

/** Writing system of a word, used to route to a provider. */
export type Script = 'latin' | 'hangul' | 'cjk' | 'other';

function classifyCode(code: number): Script {
  // Hangul syllables + Jamo
  if (
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3130 && code <= 0x318f)
  ) {
    return 'hangul';
  }
  // Han + Kana + fullwidth
  if (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0xff00 && code <= 0xffef)
  ) {
    return 'cjk';
  }
  // Latin: Basic Latin letters + Latin-1/Extended letters
  if (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x00c0 && code <= 0x024f)
  ) {
    return 'latin';
  }
  return 'other';
}

/** Dominant script of a word (ties resolve latin > hangul > cjk > other). */
export function scriptOf(word: string): Script {
  const counts: Record<Script, number> = { latin: 0, hangul: 0, cjk: 0, other: 0 };
  for (const ch of word) counts[classifyCode(ch.codePointAt(0)!)]++;
  const order: Script[] = ['latin', 'hangul', 'cjk', 'other'];
  let best: Script = 'other';
  let bestN = -1;
  for (const s of order) {
    if (counts[s] > bestN) {
      bestN = counts[s];
      best = s;
    }
  }
  return best;
}

export function langForScript(script: Script): Lang {
  if (script === 'latin') return 'en';
  if (script === 'hangul') return 'ko';
  return 'skip';
}

/** A pluggable spell-checking backend. All methods are async. */
export interface SpellChecker {
  /** true = correct or not-checkable; false = misspelled. */
  check(word: string, lang: Lang): Promise<boolean>;
  /** Ordered correction suggestions, best first. */
  suggest(word: string, lang: Lang): Promise<string[]>;
  /** Whether this provider handles the given language. */
  supports(lang: Lang): boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/docs test run test/spell/spell-checker.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/spell/spell-checker.ts packages/docs/test/spell/spell-checker.test.ts
git commit -m "Docs spell: SpellChecker interface + script classifier"
```

---

### Task 2: Word tokenizer with skip rules

**Files:**
- Create: `packages/docs/src/spell/tokenize.ts`
- Test: `packages/docs/test/spell/tokenize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface WordToken { start: number; end: number; word: string }`
  - `function tokenizeWords(text: string): WordToken[]` — emits checkable word tokens, applying static skip rules (numbers, URLs, emails, acronyms, < 2 chars). Does NOT apply caret/IME skips (those are session-level).

- [ ] **Step 1: Write the failing test**

```ts
// packages/docs/test/spell/tokenize.test.ts
import { describe, it, expect } from 'vitest';
import { tokenizeWords } from '../../src/spell/tokenize.js';

const words = (t: string) => tokenizeWords(t).map((w) => w.word);

describe('tokenizeWords', () => {
  it('splits on spaces and punctuation', () => {
    expect(words('hello world, friend')).toEqual(['hello', 'world', 'friend']);
  });
  it('keeps apostrophes inside words', () => {
    expect(words("don't stop")).toEqual(["don't", 'stop']);
  });
  it('reports correct offsets', () => {
    const toks = tokenizeWords('ab cde');
    expect(toks).toEqual([
      { start: 0, end: 2, word: 'ab' },
      { start: 3, end: 6, word: 'cde' },
    ]);
  });
  it('skips pure numbers', () => {
    expect(words('there are 42 cats')).toEqual(['there', 'are', 'cats']);
  });
  it('skips URLs and emails', () => {
    expect(words('see https://a.com or me@x.io now')).toEqual(['see', 'or', 'now']);
  });
  it('skips all-caps acronyms', () => {
    expect(words('the API and HTML')).toEqual(['the', 'and']);
  });
  it('skips tokens shorter than 2 chars', () => {
    expect(words('a big I')).toEqual(['big']);
  });
  it('keeps Hangul and CJK tokens (routing decides later)', () => {
    expect(words('안녕 world 日本')).toEqual(['안녕', 'world', '日本']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs test run test/spell/tokenize.test.ts`
Expected: FAIL — cannot find module `tokenize.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/docs/src/spell/tokenize.ts

export interface WordToken {
  start: number;
  end: number;
  word: string;
}

// A run of letters (any script), digits, apostrophes/hyphens kept internal.
const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
const URL_RE = /^(https?:\/\/|www\.)/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HAS_LETTER_RE = /\p{L}/u;
const HAS_DIGIT_RE = /\p{N}/u;

function isSkippable(word: string): boolean {
  if (word.length < 2) return true;
  if (URL_RE.test(word) || EMAIL_RE.test(word)) return true;
  // pure number (no letters)
  if (!HAS_LETTER_RE.test(word)) return true;
  // alnum mix containing a digit (e.g. h2o, v2) — treat as non-word
  if (HAS_DIGIT_RE.test(word)) return true;
  // all-caps acronym, length >= 2 (only meaningful for cased scripts)
  if (word.length >= 2 && word === word.toUpperCase() && word !== word.toLowerCase()) {
    return true;
  }
  return false;
}

/** Emit checkable word tokens with static skip rules applied. */
export function tokenizeWords(text: string): WordToken[] {
  const out: WordToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const word = m[0];
    const start = m.index!;
    // strip trailing apostrophes/hyphens from the matched span for offsets
    if (isSkippable(word)) continue;
    out.push({ start, end: start + word.length, word });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/docs test run test/spell/tokenize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/spell/tokenize.ts packages/docs/test/spell/tokenize.test.ts
git commit -m "Docs spell: word tokenizer with static skip rules"
```

---

### Task 3: LocalSpellProvider (nspell + lazy en_US)

**Files:**
- Modify: `packages/docs/package.json` (add `nspell`, `dictionary-en`)
- Create: `packages/docs/src/spell/local-provider.ts`
- Test: `packages/docs/test/spell/local-provider.test.ts`

**Interfaces:**
- Consumes: `SpellChecker`, `Lang` from `spell-checker.js`.
- Produces:
  - `class LocalSpellProvider implements SpellChecker` with an injectable loader for tests: `constructor(loadDict?: () => Promise<{ aff: Uint8Array | Buffer; dic: Uint8Array | Buffer }>)`. Default loader dynamic-imports `dictionary-en`.

- [ ] **Step 1: Add dependencies**

Run:
```bash
pnpm --filter @wafflebase/docs add nspell dictionary-en
pnpm --filter @wafflebase/docs add -D @types/nspell
```
Expected: `nspell` + `dictionary-en` in `dependencies`, `@types/nspell` in `devDependencies`. (If `@types/nspell` is unavailable, add `declare module 'nspell';` to a new `packages/docs/src/spell/nspell.d.ts` instead.)

- [ ] **Step 2: Write the failing test**

```ts
// packages/docs/test/spell/local-provider.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { LocalSpellProvider } from '../../src/spell/local-provider.js';

// Resolve the dictionary-en data files directly for the Node test.
const require = createRequire(import.meta.url);
function loadDict() {
  const dir = require.resolve('dictionary-en').replace(/index\.[a-z]+$/, '');
  return Promise.resolve({
    aff: readFileSync(dir + 'index.aff'),
    dic: readFileSync(dir + 'index.dic'),
  });
}

describe('LocalSpellProvider', () => {
  it('supports only en', () => {
    const p = new LocalSpellProvider(loadDict);
    expect(p.supports('en')).toBe(true);
    expect(p.supports('ko')).toBe(false);
  });
  it('accepts correctly spelled words', async () => {
    const p = new LocalSpellProvider(loadDict);
    expect(await p.check('hello', 'en')).toBe(true);
  });
  it('flags misspellings and suggests corrections', async () => {
    const p = new LocalSpellProvider(loadDict);
    expect(await p.check('helllo', 'en')).toBe(false);
    const s = await p.suggest('helllo', 'en');
    expect(s).toContain('hello');
  });
  it('returns true (not-checkable) for non-en langs', async () => {
    const p = new LocalSpellProvider(loadDict);
    expect(await p.check('안녕', 'ko')).toBe(true);
  });
});
```

> Note: if `dictionary-en` ships ESM-only data with a different file layout, adjust `loadDict` in the test to match the package's actual `index.aff`/`index.dic` paths. The production loader (Step 3) uses the package's documented default export, not file reads.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs test run test/spell/local-provider.test.ts`
Expected: FAIL — cannot find module `local-provider.js`.

- [ ] **Step 4: Write minimal implementation**

```ts
// packages/docs/src/spell/local-provider.ts
import nspell from 'nspell';
import type { Lang, SpellChecker } from './spell-checker.js';

type Dict = { aff: Uint8Array | Buffer; dic: Uint8Array | Buffer };
type NSpell = ReturnType<typeof nspell>;

/** Default loader: lazy dynamic import keeps the dictionary out of the
 *  main bundle (Vite emits it as a separate chunk). */
async function defaultLoadDict(): Promise<Dict> {
  const mod = await import('dictionary-en');
  const load = (mod.default ?? mod) as unknown as () => Promise<Dict>;
  return load();
}

/** In-process English spell checker backed by nspell + a Hunspell dict. */
export class LocalSpellProvider implements SpellChecker {
  private speller: Promise<NSpell> | null = null;

  constructor(private loadDict: () => Promise<Dict> = defaultLoadDict) {}

  supports(lang: Lang): boolean {
    return lang === 'en';
  }

  private getSpeller(): Promise<NSpell> {
    if (!this.speller) {
      this.speller = this.loadDict().then((d) => nspell(d));
    }
    return this.speller;
  }

  async check(word: string, lang: Lang): Promise<boolean> {
    if (lang !== 'en') return true; // not-checkable → treat as correct
    const s = await this.getSpeller();
    return s.correct(word);
  }

  async suggest(word: string, lang: Lang): Promise<string[]> {
    if (lang !== 'en') return [];
    const s = await this.getSpeller();
    return s.suggest(word);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/docs test run test/spell/local-provider.test.ts`
Expected: PASS. (If the test's `loadDict` path resolution fails, fix it per the Step-2 note — the provider code is correct regardless.)

- [ ] **Step 6: Commit**

```bash
git add packages/docs/package.json packages/docs/src/spell/local-provider.ts packages/docs/test/spell/local-provider.test.ts ../../pnpm-lock.yaml
git commit -m "Docs spell: LocalSpellProvider (nspell + lazy en_US dict)"
```

---

### Task 4: SpellRouter

**Files:**
- Create: `packages/docs/src/spell/router.ts`
- Test: `packages/docs/test/spell/router.test.ts`

**Interfaces:**
- Consumes: `SpellChecker`, `scriptOf`, `langForScript` from `spell-checker.js`.
- Produces:
  - `class SpellRouter` — `constructor(providers: SpellChecker[])`; `async check(word): Promise<boolean>`; `async suggest(word): Promise<string[]>`. Routes by `langForScript(scriptOf(word))`; if no registered provider `supports` the lang, returns `true` (un-flagged) / `[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/docs/test/spell/router.test.ts
import { describe, it, expect } from 'vitest';
import { SpellRouter } from '../../src/spell/router.js';
import type { Lang, SpellChecker } from '../../src/spell/spell-checker.js';

class FakeEn implements SpellChecker {
  supports(l: Lang) { return l === 'en'; }
  async check(w: string) { return w === 'good'; }
  async suggest() { return ['good']; }
}

describe('SpellRouter', () => {
  it('routes latin words to the en provider', async () => {
    const r = new SpellRouter([new FakeEn()]);
    expect(await r.check('good')).toBe(true);
    expect(await r.check('baad')).toBe(false);
    expect(await r.suggest('baad')).toEqual(['good']);
  });
  it('leaves hangul un-flagged when no ko provider exists', async () => {
    const r = new SpellRouter([new FakeEn()]);
    expect(await r.check('안녕')).toBe(true);
    expect(await r.suggest('안녕')).toEqual([]);
  });
  it('skips CJK words', async () => {
    const r = new SpellRouter([new FakeEn()]);
    expect(await r.check('日本')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs test run test/spell/router.test.ts`
Expected: FAIL — cannot find module `router.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/docs/src/spell/router.ts
import {
  langForScript,
  scriptOf,
  type Lang,
  type SpellChecker,
} from './spell-checker.js';

/** Routes each word to a provider by its detected language/script. */
export class SpellRouter {
  constructor(private providers: SpellChecker[]) {}

  private providerFor(lang: Lang): SpellChecker | undefined {
    if (lang === 'skip') return undefined;
    return this.providers.find((p) => p.supports(lang));
  }

  async check(word: string): Promise<boolean> {
    const lang = langForScript(scriptOf(word));
    const p = this.providerFor(lang);
    if (!p) return true; // no checker → treat as correct
    return p.check(word, lang);
  }

  async suggest(word: string): Promise<string[]> {
    const lang = langForScript(scriptOf(word));
    const p = this.providerFor(lang);
    if (!p) return [];
    return p.suggest(word, lang);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/docs test run test/spell/router.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/spell/router.ts packages/docs/test/spell/router.test.ts
git commit -m "Docs spell: SpellRouter (script-based provider routing)"
```

---

### Task 5: BackendSpellProvider

**Files:**
- Create: `packages/docs/src/spell/backend-provider.ts`
- Test: `packages/docs/test/spell/backend-provider.test.ts`

**Interfaces:**
- Consumes: `SpellChecker`, `Lang`.
- Produces:
  - `class BackendSpellProvider implements SpellChecker` — `constructor(opts: { endpoint: string; langs?: Lang[]; fetchImpl?: typeof fetch })`. POSTs `{ word, lang }` to `${endpoint}/check` (expects `{ correct: boolean }`) and `${endpoint}/suggest` (expects `{ suggestions: string[] }`). `supports` returns true for configured `langs` (default `['ko']`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/docs/test/spell/backend-provider.test.ts
import { describe, it, expect, vi } from 'vitest';
import { BackendSpellProvider } from '../../src/spell/backend-provider.js';

function mockFetch(body: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
}

describe('BackendSpellProvider', () => {
  it('supports configured langs only', () => {
    const p = new BackendSpellProvider({ endpoint: '/api/v1/spell', fetchImpl: mockFetch({}) });
    expect(p.supports('ko')).toBe(true);
    expect(p.supports('en')).toBe(false);
  });
  it('checks a word via the endpoint', async () => {
    const f = mockFetch({ correct: false });
    const p = new BackendSpellProvider({ endpoint: '/api/v1/spell', fetchImpl: f });
    expect(await p.check('안뇽', 'ko')).toBe(false);
    expect(f).toHaveBeenCalledWith('/api/v1/spell/check', expect.objectContaining({ method: 'POST' }));
  });
  it('returns suggestions via the endpoint', async () => {
    const p = new BackendSpellProvider({ endpoint: '/api/v1/spell', fetchImpl: mockFetch({ suggestions: ['안녕'] }) });
    expect(await p.suggest('안뇽', 'ko')).toEqual(['안녕']);
  });
  it('fails open (treats as correct) on network error', async () => {
    const f = vi.fn(async () => { throw new Error('net'); }) as unknown as typeof fetch;
    const p = new BackendSpellProvider({ endpoint: '/api/v1/spell', fetchImpl: f });
    expect(await p.check('안뇽', 'ko')).toBe(true);
    expect(await p.suggest('안뇽', 'ko')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs test run test/spell/backend-provider.test.ts`
Expected: FAIL — cannot find module `backend-provider.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/docs/src/spell/backend-provider.ts
import type { Lang, SpellChecker } from './spell-checker.js';

interface BackendOpts {
  endpoint: string;
  langs?: Lang[];
  fetchImpl?: typeof fetch;
}

/** Spell checker that delegates to a backend service. Fails open on error
 *  (a network problem must never paint false squiggles). Server-side
 *  dictionary (e.g. Korean) is deferred; this class is the wired contract. */
export class BackendSpellProvider implements SpellChecker {
  private langs: Lang[];
  private fetchImpl: typeof fetch;

  constructor(private opts: BackendOpts) {
    this.langs = opts.langs ?? ['ko'];
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  supports(lang: Lang): boolean {
    return this.langs.includes(lang);
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const res = await this.fetchImpl(`${this.opts.endpoint}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async check(word: string, lang: Lang): Promise<boolean> {
    const r = await this.post<{ correct: boolean }>('/check', { word, lang });
    return r ? r.correct : true; // fail open
  }

  async suggest(word: string, lang: Lang): Promise<string[]> {
    const r = await this.post<{ suggestions: string[] }>('/suggest', { word, lang });
    return r?.suggestions ?? [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/docs test run test/spell/backend-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/spell/backend-provider.ts packages/docs/test/spell/backend-provider.test.ts
git commit -m "Docs spell: BackendSpellProvider (wired contract, fail-open)"
```

---

### Task 6: SpellSession (view-local range set + replace)

**Files:**
- Create: `packages/docs/src/spell/session.ts`
- Test: `packages/docs/test/spell/session.test.ts`

**Interfaces:**
- Consumes: `SpellRouter`; `tokenizeWords`; `Doc` (from `../document.js`), `getBlockText` (from `../view/types.js` per the explore — confirm import path at impl time), `DocStore`/`snapshot`.
- Produces:
  - `interface SpellError { blockId: string; start: number; end: number; word: string }`
  - `class SpellSession`:
    - `constructor(router: SpellRouter, opts?: { snapshot?: () => void })`
    - `errors: SpellError[]`
    - `async recheckBlocks(blocks: Array<{ id: string; text: string }>, opts?: { caret?: { blockId: string; offset: number }; composing?: boolean }): Promise<void>` — tokenizes each block, skips the caret word + composing, routes via router, caches results per word, fills `errors`.
    - `errorAt(blockId: string, offset: number): SpellError | undefined`
    - `replace(doc: DocLike, error: SpellError, correction: string): void` — `snapshot()` then delete+insert; `DocLike = { deleteText(pos, len): void; insertText(pos, text): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/docs/test/spell/session.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SpellSession } from '../../src/spell/session.js';
import { SpellRouter } from '../../src/spell/router.js';
import type { Lang, SpellChecker } from '../../src/spell/spell-checker.js';

class FakeEn implements SpellChecker {
  supports(l: Lang) { return l === 'en'; }
  async check(w: string) { return w !== 'helllo' && w !== 'wrld'; }
  async suggest(w: string) { return w === 'helllo' ? ['hello'] : ['world']; }
}
const router = () => new SpellRouter([new FakeEn()]);

describe('SpellSession', () => {
  it('collects misspelled ranges across blocks', async () => {
    const s = new SpellSession(router());
    await s.recheckBlocks([
      { id: 'b1', text: 'helllo there' },
      { id: 'b2', text: 'the wrld' },
    ]);
    expect(s.errors).toEqual([
      { blockId: 'b1', start: 0, end: 6, word: 'helllo' },
      { blockId: 'b2', start: 4, end: 8, word: 'wrld' },
    ]);
  });

  it('skips the word currently under the caret', async () => {
    const s = new SpellSession(router());
    await s.recheckBlocks([{ id: 'b1', text: 'helllo there' }], {
      caret: { blockId: 'b1', offset: 3 }, // inside "helllo"
    });
    expect(s.errors).toEqual([]);
  });

  it('skips all blocks while composing', async () => {
    const s = new SpellSession(router());
    await s.recheckBlocks([{ id: 'b1', text: 'helllo' }], { composing: true });
    expect(s.errors).toEqual([]);
  });

  it('hit-tests an offset to its error', async () => {
    const s = new SpellSession(router());
    await s.recheckBlocks([{ id: 'b1', text: 'helllo there' }]);
    expect(s.errorAt('b1', 2)?.word).toBe('helllo');
    expect(s.errorAt('b1', 8)).toBeUndefined();
  });

  it('replace() snapshots then deletes+inserts', () => {
    const snapshot = vi.fn();
    const s = new SpellSession(router(), { snapshot });
    const doc = { deleteText: vi.fn(), insertText: vi.fn() };
    s.replace(doc, { blockId: 'b1', start: 0, end: 6, word: 'helllo' }, 'hello');
    expect(snapshot).toHaveBeenCalledOnce();
    expect(doc.deleteText).toHaveBeenCalledWith({ blockId: 'b1', offset: 0 }, 6);
    expect(doc.insertText).toHaveBeenCalledWith({ blockId: 'b1', offset: 0 }, 'hello');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs test run test/spell/session.test.ts`
Expected: FAIL — cannot find module `session.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/docs/src/spell/session.ts
import type { SpellRouter } from './router.js';
import { tokenizeWords } from './tokenize.js';

export interface SpellError {
  blockId: string;
  start: number;
  end: number;
  word: string;
}

/** Minimal Doc surface SpellSession needs for replacement. */
export interface DocLike {
  deleteText(pos: { blockId: string; offset: number }, length: number): void;
  insertText(pos: { blockId: string; offset: number }, text: string): void;
}

interface RecheckOpts {
  caret?: { blockId: string; offset: number };
  composing?: boolean;
}

/** View-local spell state. Never serialized to the CRDT. */
export class SpellSession {
  errors: SpellError[] = [];
  private cache = new Map<string, boolean>(); // word → correct?

  constructor(
    private router: SpellRouter,
    private opts: { snapshot?: () => void } = {},
  ) {}

  async recheckBlocks(
    blocks: Array<{ id: string; text: string }>,
    opts: RecheckOpts = {},
  ): Promise<void> {
    if (opts.composing) {
      this.errors = [];
      return;
    }
    const next: SpellError[] = [];
    for (const block of blocks) {
      for (const tok of tokenizeWords(block.text)) {
        // skip the word the caret is currently inside
        if (
          opts.caret &&
          opts.caret.blockId === block.id &&
          opts.caret.offset >= tok.start &&
          opts.caret.offset <= tok.end
        ) {
          continue;
        }
        const correct = await this.isCorrect(tok.word);
        if (!correct) {
          next.push({ blockId: block.id, start: tok.start, end: tok.end, word: tok.word });
        }
      }
    }
    this.errors = next;
  }

  private async isCorrect(word: string): Promise<boolean> {
    const cached = this.cache.get(word);
    if (cached !== undefined) return cached;
    const correct = await this.router.check(word);
    this.cache.set(word, correct);
    return correct;
  }

  errorAt(blockId: string, offset: number): SpellError | undefined {
    return this.errors.find(
      (e) => e.blockId === blockId && offset >= e.start && offset <= e.end,
    );
  }

  replace(doc: DocLike, error: SpellError, correction: string): void {
    this.opts.snapshot?.();
    doc.deleteText({ blockId: error.blockId, offset: error.start }, error.end - error.start);
    doc.insertText({ blockId: error.blockId, offset: error.start }, correction);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/docs test run test/spell/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/spell/session.ts packages/docs/test/spell/session.test.ts
git commit -m "Docs spell: SpellSession view-local range set + replace"
```

---

### Task 7: Render red squiggles

**Files:**
- Modify: `packages/docs/src/view/doc-canvas.ts` (add trailing `spellErrorRects` param to `render(...)`; draw squiggles in the highlight pass alongside `commentMarkers`)
- Modify: `packages/docs/src/view/editor.ts` (compute spell rects via `computeSelectionRects`, cache for hit-testing, pass to `canvas.render(...)`)

**Interfaces:**
- Consumes: `SpellError` (from `../spell/session.js`), `computeSelectionRects` (selection.js), `SpellSession`, `SpellRouter`, `LocalSpellProvider`.
- Produces: a private `drawSquiggle(rect)` behavior in doc-canvas; editor-side `spellErrorRects` closure cache.

- [ ] **Step 1: Add the render param + squiggle draw (doc-canvas.ts)**

Append a new positional parameter at the very end of the `render(...)` signature (after `commentMarkers`):

```ts
    commentMarkers?: ReadonlyArray<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>,
    /** Red wavy underlines for misspelled words. View-local; the canvas
     *  is spell-naive — it just strokes the rects it is given. */
    spellErrorRects?: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  ): void {
```

Then, immediately AFTER the existing `if (commentMarkers) { ... }` block (the comment-marker draw, ~lines 390-398), add:

```ts
    if (spellErrorRects) {
      this.ctx.save();
      this.ctx.strokeStyle = '#e53935';
      this.ctx.lineWidth = 1;
      for (const rect of spellErrorRects) {
        if (rect.y + rect.height <= pageY || rect.y >= pageY + page.height) continue;
        const baseY = rect.y + rect.height - 1;
        const amp = 1.5;
        const step = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(rect.x, baseY);
        let up = true;
        for (let x = rect.x; x <= rect.x + rect.width; x += step) {
          this.ctx.lineTo(x, baseY + (up ? -amp : 0));
          up = !up;
        }
        this.ctx.stroke();
      }
      this.ctx.restore();
    }
```

> The `pageY`/`page` variables are the per-page loop locals already used by the search/comment draw blocks — place this block in the same scope (inside the page loop where `commentMarkers` is drawn). Confirm the enclosing scope when editing.

- [ ] **Step 2: Compute + pass spell rects (editor.ts)**

After the comment-marker rect computation (~line 1470), add (mirroring it):

```ts
    // Compute spell-error rectangles (view-local; never persisted).
    let spellErrorRects: Array<{ x: number; y: number; width: number; height: number }> = [];
    if (this.spellSession) {
      for (const err of this.spellSession.errors) {
        const rects = computeSelectionRects(
          {
            anchor: { blockId: err.blockId, offset: err.start },
            focus: { blockId: err.blockId, offset: err.end },
          },
          paginatedLayout,
          layout,
          measurer,
          logicalCanvasWidth,
        );
        spellErrorRects.push(...rects);
      }
    }
    this.lastSpellErrorRects = spellErrorRects; // cache for hit-testing (Task 8)
```

Add fields near the other view-state fields on the editor class:

```ts
  private spellSession: SpellSession | null = null;
  private lastSpellErrorRects: Array<{ x: number; y: number; width: number; height: number }> = [];
```

Pass `spellErrorRects` as the new trailing argument to the existing `this.canvas.render(...)` call (after the `commentMarkers` argument).

- [ ] **Step 3: Build + typecheck**

Run: `pnpm --filter @wafflebase/docs build`
Expected: build succeeds (no type errors). If `nspell`/`dictionary-en` lack types, the `.d.ts` shim from Task 3 resolves it.

- [ ] **Step 4: Verify squiggle math with a unit test (doc-canvas pure helper)**

Extract the zigzag point generation into a tiny pure helper to make it testable:

```ts
// add near top of doc-canvas.ts (exported for test)
export function squigglePoints(x: number, w: number, baseY: number, amp = 1.5, step = 2): Array<[number, number]> {
  const pts: Array<[number, number]> = [[x, baseY]];
  let up = true;
  for (let px = x; px <= x + w; px += step) {
    pts.push([px, baseY + (up ? -amp : 0)]);
    up = !up;
  }
  return pts;
}
```

Use `squigglePoints` inside the draw loop instead of the inline math. Test:

```ts
// packages/docs/test/view/squiggle.test.ts
import { describe, it, expect } from 'vitest';
import { squigglePoints } from '../../src/view/doc-canvas.js';

describe('squigglePoints', () => {
  it('alternates above and on the baseline', () => {
    const pts = squigglePoints(0, 4, 10, 2, 2);
    expect(pts[0]).toEqual([0, 10]);
    expect(pts[1]).toEqual([0, 8]);  // up
    expect(pts[2]).toEqual([2, 10]); // down
    expect(pts[3]).toEqual([4, 8]);  // up
  });
});
```

Run: `pnpm --filter @wafflebase/docs test run test/view/squiggle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/doc-canvas.ts packages/docs/src/view/editor.ts packages/docs/test/view/squiggle.test.ts
git commit -m "Docs spell: render red squiggles under misspelled words"
```

---

### Task 8: Suggestions popover + wiring

**Files:**
- Modify: `packages/docs/src/view/editor.ts` (construct `SpellSession`+router+provider; debounced recheck on cursor move/edit; `contextmenu` listener; popover DOM; `EditorAPI` additions)
- Modify: `packages/docs/src/index.ts` (export `SpellSession` and provider types if needed)
- Test: manual smoke (Canvas DOM popover is integration-tested by hand)

**Interfaces:**
- Consumes: `SpellSession`, `SpellRouter`, `LocalSpellProvider`, `lastSpellErrorRects`, `getDoc()`, `isComposing()`.
- Produces: `EditorAPI.setSpellCheckEnabled(enabled: boolean): void` (internal default-on); private `handleSpellContextMenu(e: MouseEvent)`.

- [ ] **Step 1: Construct the session + schedule rechecks**

In `initialize(...)` (or the editor constructor), after the store/doc are available:

```ts
    this.spellSession = new SpellSession(
      new SpellRouter([new LocalSpellProvider()]),
      { snapshot: () => store?.snapshot() },
    );
    this.scheduleSpellRecheck();
```

Add a debounced recheck that scans the current document blocks and re-paints:

```ts
  private spellTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleSpellRecheck(): void {
    if (!this.spellSession) return;
    if (this.spellTimer) clearTimeout(this.spellTimer);
    this.spellTimer = setTimeout(() => {
      void this.runSpellRecheck();
    }, 300);
  }

  private async runSpellRecheck(): Promise<void> {
    if (!this.spellSession) return;
    const doc = this.getDoc();
    const blocks = doc.getContextBlocks().map((b) => ({
      id: b.id,
      text: getBlockText(b),
    }));
    const caret = this.getCaretPosition?.(); // { blockId, offset } | undefined
    await this.spellSession.recheckBlocks(blocks, {
      caret,
      composing: this.isComposing(),
    });
    this.paint(); // repaint-only (no layout recompute)
  }
```

Call `this.scheduleSpellRecheck()` from the existing edit/cursor-change notification path (where `onCursorMove`/input handling fires). Confirm the exact hook (`onCursorMove` callback list ~editor.ts:109) at implementation time.

> `getBlockText` import: `import { getBlockText } from './types.js';` (confirm path — explore reported it in the view types module). `getCaretPosition`: use the editor's existing selection accessor; if none returns `{blockId, offset}`, derive from the current `Selection`/cursor state already tracked in the editor.

- [ ] **Step 2: Add the contextmenu handler + popover**

Register in the same place other container listeners are attached (TextEditor ~lines 399-408 / editor init):

```ts
    container.addEventListener('contextmenu', this.handleSpellContextMenu);
```

```ts
  private handleSpellContextMenu = (e: MouseEvent): void => {
    if (!this.spellSession) return;
    const hit = this.hitTestSpell(e); // → SpellError | undefined using lastSpellErrorRects
    if (!hit) return; // no squiggle under cursor → let default menu through
    e.preventDefault();
    void this.openSpellPopover(e.clientX, e.clientY, hit);
  };

  private hitTestSpell(e: MouseEvent): SpellError | undefined {
    const { x, y } = this.toCanvasPoint(e); // existing helper used by mouse handlers
    // find which rect contains the point, then map back to its error
    for (let i = 0; i < this.spellSession!.errors.length; i++) {
      // rects were pushed per-error in order; rebuild a parallel index if needed
    }
    // Simplest robust approach: re-run errorAt using the doc position under cursor.
    const pos = this.positionFromPoint(x, y); // existing hit-test → { blockId, offset }
    return pos ? this.spellSession!.errorAt(pos.blockId, pos.offset) : undefined;
  }

  private async openSpellPopover(clientX: number, clientY: number, err: SpellError): Promise<void> {
    const suggestions = await this.spellSession!.router.suggest(err.word);
    // Build a small absolutely-positioned <div> menu at (clientX, clientY).
    // Each suggestion is a button; clicking calls:
    //   this.spellSession!.replace(this.getDoc(), err, suggestion);
    //   this.render(); close popover.
    // Empty suggestions → a single disabled "No suggestions" item.
  }
```

> `toCanvasPoint`/`positionFromPoint`: the editor already converts mouse events to doc positions for click-to-place-caret (the `handleMouseDown` path). Reuse that exact helper rather than re-deriving. Expose `router` on `SpellSession` (make the field public or add a `suggest(word)` passthrough) so the popover can fetch suggestions.

- [ ] **Step 3: Build + smoke test**

Run: `pnpm --filter @wafflebase/docs build`
Then `pnpm dev`, open a doc, type `helllo wrld`, confirm: red squiggles appear after ~300ms, typing the word shows no squiggle until caret leaves it, right-click a squiggle shows suggestions, clicking replaces and is undoable with Ctrl+Z.

- [ ] **Step 4: Commit**

```bash
git add packages/docs/src/view/editor.ts packages/docs/src/index.ts
git commit -m "Docs spell: suggestions popover + recheck wiring"
```

---

### Task 9: Docs, verify, wrap-up

**Files:**
- Modify: `docs/design/docs/docs-wordprocessor-roadmap.md` (mark spell check shipped where listed)
- Modify: `docs/tasks/active/20260628-docs-spell-check-todo.md` (check off items, add Review section)
- Modify: `docs/tasks/active/20260628-docs-spell-check-lessons.md`

- [ ] **Step 1: Run the full fast gate**

Run: `pnpm verify:fast`
Expected: lint + unit tests green (including all `test/spell/*` and `test/view/squiggle.test.ts`).

- [ ] **Step 2: Self code-review over the branch diff**

Dispatch `/code-review` (or `superpowers:requesting-code-review`) over `git diff main...docs-spell-check`. Apply blocking findings; note non-blocking ones in the lessons file.

- [ ] **Step 3: Update roadmap + task docs**

Edit `docs/design/docs/docs-wordprocessor-roadmap.md` lines 65 & 123 region to reflect spell check shipped (English; Korean server deferred). Check off the todo file and fill its Review section. Add lessons.

- [ ] **Step 4: Commit + archive**

```bash
git add docs/
git commit -m "Docs spell: mark roadmap shipped + task wrap-up"
pnpm tasks:archive && pnpm tasks:index
git add docs/ && git commit -m "Docs: archive spell check task"
```

- [ ] **Step 5: Open PR**

```bash
git fetch && git rebase origin/main
git push -u origin docs-spell-check
gh pr create --title "Docs: spell check (red squiggles + suggestions)" --body "..."
```

---

## Self-Review

**Spec coverage:**
- Module layout (spell-checker/local-provider/backend-provider/router/session/tokenize) → Tasks 1–6. ✓
- Local English provider end-to-end → Tasks 3, 7, 8. ✓
- Backend provider wired-but-deferred → Task 5. ✓
- Script-based per-word routing → Tasks 1, 4. ✓
- View-local session, debounce, cache, visible-only → Task 6 (debounce/visible-scoping wired in Task 8; note: v1 scans all context blocks, "visible-only" optimization deferred — see Risk note below). ✓ (scope note)
- Rendering via search/comment path → Task 7. ✓
- Suggestions popover + replace → Task 8. ✓
- Tests incl. "no spell state in CRDT" → covered: SpellSession only calls text mutations + snapshot, never store schema writes (Task 6 test asserts delete/insert only). ✓
- Skip rules (IME, caret word, numbers, URLs, acronyms, CJK) → Tasks 2 + 6. ✓

**Scope deviation to confirm during execution:** The spec calls for "visible-blocks-only" rechecking. The plan's Task 8 scans all context blocks for simplicity. For large docs this should be narrowed to the viewport. Logged as a known limitation; revisit if perf is poor in the Step-3 smoke test of Task 8.

**Placeholder scan:** Task 8's `openSpellPopover`/`hitTestSpell` bodies describe DOM construction in prose because they depend on the editor's existing mouse→position helper, whose exact name must be read at implementation time. These are integration glue, not new algorithms; the data flow and calls are fully specified. Acceptable — flagged for the implementer to wire to the real helper.

**Type consistency:** `SpellError`, `Lang`, `Script`, `SpellChecker`, `SpellRouter`, `SpellSession`, `LocalSpellProvider`, `BackendSpellProvider`, `tokenizeWords`, `WordToken`, `scriptOf`, `langForScript`, `squigglePoints` — names used consistently across tasks. `replace()` signature `(doc, error, correction)` matches its test and its caller in Task 8.
