import {
  decryptWithKey,
  encryptWithKey,
  parseHexKey,
} from '../datasource/crypto.util';

/**
 * At-rest encryption of webhook signing secrets. They must be decryptable to
 * sign, so they are encrypted (AES-256-GCM, `crypto.util.ts`) rather than
 * hashed like API keys.
 *
 * The key is `WAFFLEBASE_SECRETS_ENCRYPTION_KEY`, falling back to
 * `DATASOURCE_ENCRYPTION_KEY` so a deployment that already set the datasource
 * key needs nothing new. Changing which key is in effect after webhooks exist
 * makes their secrets undecryptable; the owner rotates them.
 */
function secretsKey(): Buffer {
  const explicit = process.env.WAFFLEBASE_SECRETS_ENCRYPTION_KEY?.trim();
  if (explicit) {
    return parseHexKey(explicit, 'WAFFLEBASE_SECRETS_ENCRYPTION_KEY');
  }
  return parseHexKey(
    process.env.DATASOURCE_ENCRYPTION_KEY?.trim(),
    'WAFFLEBASE_SECRETS_ENCRYPTION_KEY (or DATASOURCE_ENCRYPTION_KEY)',
  );
}

export function encryptSecret(plain: string): string {
  return encryptWithKey(plain, secretsKey());
}

export function decryptSecret(enc: string): string {
  return decryptWithKey(enc, secretsKey());
}

/**
 * Why no secret can be encrypted right now, or `null` when the key is usable.
 * Checked at boot and before a create, so a deployment that turned webhooks on
 * without a key hears so in words instead of a 500.
 */
export function secretsKeyProblem(): string | null {
  try {
    secretsKey();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
