import {
  decryptSecret,
  encryptSecret,
  secretsKeyProblem,
} from './webhook-secret';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('webhook-secret', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('round-trips under WAFFLEBASE_SECRETS_ENCRYPTION_KEY', () => {
    process.env.WAFFLEBASE_SECRETS_ENCRYPTION_KEY = KEY_A;
    delete process.env.DATASOURCE_ENCRYPTION_KEY;
    const enc = encryptSecret('whsec_abc');
    expect(enc).not.toContain('whsec_abc');
    expect(decryptSecret(enc)).toBe('whsec_abc');
  });

  it('falls back to DATASOURCE_ENCRYPTION_KEY', () => {
    delete process.env.WAFFLEBASE_SECRETS_ENCRYPTION_KEY;
    process.env.DATASOURCE_ENCRYPTION_KEY = KEY_B;
    expect(decryptSecret(encryptSecret('s'))).toBe('s');
  });

  it('prefers the dedicated key over the datasource key', () => {
    process.env.WAFFLEBASE_SECRETS_ENCRYPTION_KEY = KEY_A;
    process.env.DATASOURCE_ENCRYPTION_KEY = KEY_B;
    const enc = encryptSecret('s');
    delete process.env.WAFFLEBASE_SECRETS_ENCRYPTION_KEY;
    expect(() => decryptSecret(enc)).toThrow();
  });

  it('refuses without any key', () => {
    delete process.env.WAFFLEBASE_SECRETS_ENCRYPTION_KEY;
    delete process.env.DATASOURCE_ENCRYPTION_KEY;
    expect(() => encryptSecret('s')).toThrow(
      /WAFFLEBASE_SECRETS_ENCRYPTION_KEY/,
    );
    expect(secretsKeyProblem()).toMatch(/WAFFLEBASE_SECRETS_ENCRYPTION_KEY/);
  });

  it('reports no problem with a usable key', () => {
    process.env.WAFFLEBASE_SECRETS_ENCRYPTION_KEY = KEY_A;
    expect(secretsKeyProblem()).toBeNull();
  });
});
