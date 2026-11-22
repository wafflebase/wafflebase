import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Parse a 64-hex-character AES-256 key. `name` is the environment variable
 * it came from, so the error tells the operator which setting to fix.
 */
export function parseHexKey(key: string | undefined, name: string): Buffer {
  if (!key) {
    throw new Error(`${name} environment variable is required`);
  }
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== 32) {
    throw new Error(`${name} must be a 64-character hex string (32 bytes)`);
  }
  return buf;
}

function getKey(): Buffer {
  return parseHexKey(
    process.env.DATASOURCE_ENCRYPTION_KEY,
    'DATASOURCE_ENCRYPTION_KEY',
  );
}

/**
 * Encrypts plaintext using AES-256-GCM under `key` and returns a base64
 * payload. Exported for secrets that are not datasource credentials (webhook
 * signing secrets), which choose their own key.
 */
export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all base64)
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypts an AES-256-GCM payload produced by `encryptWithKey`.
 */
export function decryptWithKey(ciphertext: string, key: Buffer): string {
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(':');

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * Encrypts plaintext using AES-256-GCM and returns a base64 payload.
 */
export function encrypt(plaintext: string): string {
  return encryptWithKey(plaintext, getKey());
}

/**
 * Decrypts an AES-256-GCM payload produced by `encrypt`.
 */
export function decrypt(ciphertext: string): string {
  return decryptWithKey(ciphertext, getKey());
}
