import { CliAuthStore, hashCliVerifier } from './cli-auth.store';

const VERIFIER = 'v'.repeat(43);
const CHALLENGE = hashCliVerifier(VERIFIER);

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
    it('returns { mode, port } for a valid stateToken and its secret', () => {
      const { stateToken, csrf } = store.createState('browser', 9876);
      const result = store.consumeState(stateToken, csrf);
      expect(result).toEqual({ mode: 'browser', port: 9876 });
    });

    it('round-trips the PKCE challenge so the code can be bound to it', () => {
      const { stateToken, csrf } = store.createState(
        'cli',
        9876,
        undefined,
        CHALLENGE,
      );
      expect(store.consumeState(stateToken, csrf)?.challenge).toBe(CHALLENGE);
    });

    it('round-trips the CLI nonce so the callback can echo it', () => {
      const nonce = 'f'.repeat(32);
      const { stateToken, csrf } = store.createState('cli', 9876, nonce);
      expect(store.consumeState(stateToken, csrf)?.nonce).toBe(nonce);
    });

    it('is single-use: second call returns undefined', () => {
      const { stateToken, csrf } = store.createState('browser', 9876);
      store.consumeState(stateToken, csrf);
      expect(store.consumeState(stateToken, csrf)).toBeUndefined();
    });

    it('returns undefined for unknown stateToken', () => {
      expect(store.consumeState('nonexistent', 'secret')).toBeUndefined();
    });

    it('returns undefined for expired state entry', () => {
      const { stateToken, csrf } = store.createState('browser', 9876);
      // Simulate time past the 5-minute TTL
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000);
      expect(store.consumeState(stateToken, csrf)).toBeUndefined();
    });

    /**
     * The state token travels through GitHub in a URL, so it is worth
     * nothing without the cookie secret minted with it. Otherwise an
     * attacker mints a state in their own browser, hands it to a victim,
     * and the callback issues a code for the victim's account bound to
     * the attacker's challenge and loopback port.
     */
    it('returns undefined without the secret the state was minted with', () => {
      const { stateToken } = store.createState('cli', 9876, undefined, CHALLENGE);
      expect(store.consumeState(stateToken, undefined)).toBeUndefined();
    });

    it('returns undefined for a secret from a different login attempt', () => {
      const { stateToken } = store.createState('cli', 9876, undefined, CHALLENGE);
      const other = store.createState('cli', 9876, undefined, CHALLENGE);
      expect(store.consumeState(stateToken, other.csrf)).toBeUndefined();
    });

    it('burns the state on a wrong secret, so it cannot be probed', () => {
      const { stateToken, csrf } = store.createState('browser', 9876);
      store.consumeState(stateToken, 'wrong-secret');
      expect(store.consumeState(stateToken, csrf)).toBeUndefined();
    });
  });

  describe('createCode', () => {
    it('returns a non-empty code string', () => {
      const code = store.createCode(42, CHALLENGE);
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    });

    it('returns unique codes on each call', () => {
      const a = store.createCode(42, CHALLENGE);
      const b = store.createCode(42, CHALLENGE);
      expect(a).not.toBe(b);
    });
  });

  describe('consumeCode', () => {
    it('returns userId for a valid code', () => {
      const code = store.createCode(42, CHALLENGE);
      expect(store.consumeCode(code, VERIFIER)).toBe(42);
    });

    it('is single-use: second call returns undefined', () => {
      const code = store.createCode(42, CHALLENGE);
      store.consumeCode(code, VERIFIER);
      expect(store.consumeCode(code, VERIFIER)).toBeUndefined();
    });

    it('returns undefined for unknown code', () => {
      expect(store.consumeCode('nonexistent', VERIFIER)).toBeUndefined();
    });

    /**
     * The code reaches the CLI as plaintext in a loopback URL, so it must
     * not be redeemable on its own. Only the holder of the verifier the
     * challenge was derived from gets a session.
     */
    it('returns undefined when the verifier does not match the challenge', () => {
      const code = store.createCode(42, CHALLENGE);
      expect(store.consumeCode(code, 'w'.repeat(43))).toBeUndefined();
    });

    it('burns the code on a mismatched verifier, so it cannot be probed', () => {
      const code = store.createCode(42, CHALLENGE);
      store.consumeCode(code, 'w'.repeat(43));
      expect(store.consumeCode(code, VERIFIER)).toBeUndefined();
    });

    it('returns undefined for expired code entry', () => {
      const code = store.createCode(42, CHALLENGE);
      // Simulate time past the 60-second TTL
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 90 * 1000);
      expect(store.consumeCode(code, VERIFIER)).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('removes expired state entries on createState', () => {
      const { stateToken, csrf } = store.createState('browser', 9876);
      // Advance time past TTL so the entry is expired
      const futureNow = Date.now() + 6 * 60 * 1000;
      jest.spyOn(Date, 'now').mockReturnValue(futureNow);
      // Creating a new state triggers cleanup
      store.createState('browser', 1234);
      // The expired entry should be gone (consumeState returns undefined without the entry existing)
      expect(store.consumeState(stateToken, csrf)).toBeUndefined();
    });

    it('removes expired code entries on createCode', () => {
      const code = store.createCode(42, CHALLENGE);
      const futureNow = Date.now() + 90 * 1000;
      jest.spyOn(Date, 'now').mockReturnValue(futureNow);
      // Creating a new code triggers cleanup
      store.createCode(99, CHALLENGE);
      expect(store.consumeCode(code, VERIFIER)).toBeUndefined();
    });
  });
});
