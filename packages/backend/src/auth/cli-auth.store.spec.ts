import { CliAuthStore } from './cli-auth.store';

describe('CliAuthStore', () => {
  let store: CliAuthStore;

  beforeEach(() => {
    store = new CliAuthStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createState', () => {
    it('returns non-empty stateToken and csrf strings', () => {
      const result = store.createState('browser', 9876);
      expect(typeof result.stateToken).toBe('string');
      expect(result.stateToken.length).toBeGreaterThan(0);
      expect(typeof result.csrf).toBe('string');
      expect(result.csrf.length).toBeGreaterThan(0);
    });

    it('returns unique tokens on each call', () => {
      const a = store.createState('browser', 9876);
      const b = store.createState('browser', 9876);
      expect(a.stateToken).not.toBe(b.stateToken);
      expect(a.csrf).not.toBe(b.csrf);
    });
  });

  describe('consumeState', () => {
    it('returns { csrf, mode, port } for a valid stateToken', () => {
      const { stateToken, csrf } = store.createState('browser', 9876);
      const result = store.consumeState(stateToken);
      expect(result).toEqual({ csrf, mode: 'browser', port: 9876 });
    });

    it('is single-use: second call returns undefined', () => {
      const { stateToken } = store.createState('browser', 9876);
      store.consumeState(stateToken);
      expect(store.consumeState(stateToken)).toBeUndefined();
    });

    it('returns undefined for unknown stateToken', () => {
      expect(store.consumeState('nonexistent')).toBeUndefined();
    });

    it('returns undefined for expired state entry', () => {
      const { stateToken } = store.createState('browser', 9876);
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
      const { stateToken } = store.createState('browser', 9876);
      // Advance time past TTL so the entry is expired
      const futureNow = Date.now() + 6 * 60 * 1000;
      jest.spyOn(Date, 'now').mockReturnValue(futureNow);
      // Creating a new state triggers cleanup
      store.createState('browser', 1234);
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
