import { createCipheriv, randomBytes } from 'node:crypto';
import type { KeyWrapper } from './key-wrapper.js';

export const ENVELOPE_VERSION = 1;

export interface SealedSecret {
  envelopeVersion: number;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDek: Buffer;
  kekId: string;
  kekVersion: string;
  wrapAlgorithm: string;
}

/**
 * Additional authenticated data binds a ciphertext to its row: a sealed secret copied onto another
 * credential (or between team and platform tables) fails authentication on decrypt.
 */
export function credentialAad(kind: 'team' | 'platform', credentialId: string): Buffer {
  return Buffer.from(`core-credential:v${String(ENVELOPE_VERSION)}:${kind}:${credentialId}`);
}

/** Envelope encryption: fresh 256-bit DEK per secret, AES-256-GCM, DEK wrapped by the KEK and then zeroed. */
export async function sealSecret(
  wrapper: KeyWrapper,
  secret: string,
  aad: Buffer,
): Promise<SealedSecret> {
  const dek = randomBytes(32);
  const plaintext = Buffer.from(secret, 'utf8');
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrapped = await wrapper.wrap(dek);
    return {
      envelopeVersion: ENVELOPE_VERSION,
      ciphertext,
      iv,
      authTag: cipher.getAuthTag(),
      wrappedDek: wrapped.wrappedDek,
      kekId: wrapped.kekId,
      kekVersion: wrapped.kekVersion,
      wrapAlgorithm: wrapped.algorithm,
    };
  } finally {
    dek.fill(0);
    plaintext.fill(0);
  }
}

/** Shows at most the last 4 characters, and only for secrets long enough that this reveals little. */
export function displayHint(secret: string): string | null {
  return secret.length >= 16 ? `…${secret.slice(-4)}` : null;
}
