import { CliAuthStore } from './cli-auth.store';

/**
 * A CLI login's bindings. Every one of them is required — the store has no
 * way to represent a login with a binding switched off — so the tests fill
 * them in and override only what they are about.
 */
function params(over: Partial<Parameters<CliAuthStore['createState']>[0]> = {}) {
  return {
    mode: 'browser',
    port: 9876,
    browserBinding: 'binding-value',
    nonce: 'the-nonce',
    codeChallenge: 'a'.repeat(43),
    ...over,
  };
}

describe('CliAuthStore', () => {
  let store: CliAuthStore;

  beforeEach(() => {
    store = new CliAuthStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createState', () => {
    it('returns a non-empty stateToken', () => {
      const result = store.createState(params());
      expect(typeof result.stateToken).toBe('string');
      expect(result.stateToken.length).toBeGreaterThan(0);
    });

    it('returns unique tokens on each call', () => {
      const a = store.createState(params());
      const b = store.createState(params());
      expect(a.stateToken).not.toBe(b.stateToken);
    });
  });

  describe('consumeState', () => {
    // The browser binding is the half of the double submit the callback
    // compares against its cookie: lose it here and a CLI `state` minted in
    // one browser completes in any other.
    it('returns every binding it was given for a valid stateToken', () => {
      const given = params({ mode: 'cli', browserBinding: 'b-1' });
      const { stateToken } = store.createState(given);
      expect(store.consumeState(stateToken)).toEqual(given);
    });

    it('is single-use: second call returns undefined', () => {
      const { stateToken } = store.createState(params());
      store.consumeState(stateToken);
      expect(store.consumeState(stateToken)).toBeUndefined();
    });

    it('returns undefined for unknown stateToken', () => {
      expect(store.consumeState('nonexistent')).toBeUndefined();
    });

    it('returns undefined for expired state entry', () => {
      const { stateToken } = store.createState(params());
      // Simulate time past the 5-minute TTL
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000);
      expect(store.consumeState(stateToken)).toBeUndefined();
    });
  });

  describe('createCode', () => {
    it('returns a non-empty code string', () => {
      const code = store.createCode(42);
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    });

    it('returns unique codes on each call', () => {
      const a = store.createCode(42);
      const b = store.createCode(42);
      expect(a).not.toBe(b);
    });
  });

  describe('consumeCode', () => {
    it('returns userId for a valid code', () => {
      const code = store.createCode(42);
      expect(store.consumeCode(code)).toBe(42);
    });

    it('is single-use: second call returns undefined', () => {
      const code = store.createCode(42);
      store.consumeCode(code);
      expect(store.consumeCode(code)).toBeUndefined();
    });

    it('returns undefined for unknown code', () => {
      expect(store.consumeCode('nonexistent')).toBeUndefined();
    });

    it('returns undefined for expired code entry', () => {
      const code = store.createCode(42);
      // Simulate time past the 60-second TTL
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 90 * 1000);
      expect(store.consumeCode(code)).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('removes expired state entries on createState', () => {
      const { stateToken } = store.createState(params());
      // Advance time past TTL so the entry is expired
      const futureNow = Date.now() + 6 * 60 * 1000;
      jest.spyOn(Date, 'now').mockReturnValue(futureNow);
      // Creating a new state triggers cleanup
      store.createState(params({ port: 1234 }));
      // The expired entry should be gone (consumeState returns undefined without the entry existing)
      expect(store.consumeState(stateToken)).toBeUndefined();
    });

    it('removes expired code entries on createCode', () => {
      const code = store.createCode(42);
      const futureNow = Date.now() + 90 * 1000;
      jest.spyOn(Date, 'now').mockReturnValue(futureNow);
      // Creating a new code triggers cleanup
      store.createCode(99);
      expect(store.consumeCode(code)).toBeUndefined();
    });
  });
});
