import { createDecipheriv } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { credentialAad, displayHint, sealSecret } from '../../src/credentials/crypto/envelope.js';
import {
  AzureKeyVaultKeyWrapper,
  LOCAL_KEK_AAD,
  LocalKeyWrapper,
} from '../../src/credentials/crypto/key-wrapper.js';

const KEK = Buffer.alloc(32, 3).toString('base64');

/** Test-only decryption: the API itself has no decrypt path by design. */
function open(
  kekB64: string,
  sealed: { ciphertext: Buffer; iv: Buffer; authTag: Buffer; wrappedDek: Buffer },
  aad: Buffer,
): string {
  const kek = Buffer.from(kekB64, 'base64');
  const w = sealed.wrappedDek;
  const unwrap = createDecipheriv('aes-256-gcm', kek, w.subarray(0, 12));
  unwrap.setAAD(LOCAL_KEK_AAD);
  unwrap.setAuthTag(w.subarray(w.length - 16));
  const dek = Buffer.concat([unwrap.update(w.subarray(12, w.length - 16)), unwrap.final()]);
  const d = createDecipheriv('aes-256-gcm', dek, sealed.iv);
  d.setAAD(aad);
  d.setAuthTag(sealed.authTag);
  return Buffer.concat([d.update(sealed.ciphertext), d.final()]).toString('utf8');
}

describe('envelope encryption', () => {
  it('round-trips with a fresh DEK and IV per secret', async () => {
    const wrapper = new LocalKeyWrapper(KEK);
    const aad = credentialAad('team', 'c1');
    const a = await sealSecret(wrapper, 'sk-secret-value-1234', aad);
    const b = await sealSecret(wrapper, 'sk-secret-value-1234', aad);
    expect(open(KEK, a, aad)).toBe('sk-secret-value-1234');
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.includes(Buffer.from('sk-secret'))).toBe(false);
    expect(a.envelopeVersion).toBe(1);
  });

  it('binds ciphertext to the credential id and kind', async () => {
    const sealed = await sealSecret(
      new LocalKeyWrapper(KEK),
      'secret-abcdefghijkl',
      credentialAad('team', 'c1'),
    );
    expect(() => open(KEK, sealed, credentialAad('team', 'c2'))).toThrow();
    expect(() => open(KEK, sealed, credentialAad('platform', 'c1'))).toThrow();
  });

  it('matches the committed cross-language test vector format', () => {
    const v = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          '../../../../packages/contracts/test-vectors/credential-envelope-v1.json',
        ),
        'utf8',
      ),
    ) as Record<string, string>;
    const b = (k: string) => Buffer.from(v[k] ?? '', 'base64');
    const secret = open(
      v['localKekBase64'] ?? '',
      {
        ciphertext: b('ciphertext'),
        iv: b('iv'),
        authTag: b('authTag'),
        wrappedDek: b('wrappedDek'),
      },
      credentialAad('team', v['credentialId'] ?? ''),
    );
    expect(secret).toBe(v['expectedSecret']);
  });

  it('rejects KEKs of the wrong size', () => {
    expect(() => new LocalKeyWrapper(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('shows at most the last four characters of long secrets', () => {
    expect(displayHint('sk-0123456789abcdef')).toBe('…cdef');
    expect(displayHint('short-secret')).toBeNull();
  });

  it('records the Key Vault key id and version used to wrap', async () => {
    const wrapper = new AzureKeyVaultKeyWrapper({
      wrapKey: (algorithm, key) => {
        expect(algorithm).toBe('RSA-OAEP-256');
        return Promise.resolve({
          result: Buffer.from(key).reverse(),
          keyID: 'https://vault.vault.azure.net/keys/llm-kek/abc123',
        });
      },
    });
    const wrapped = await wrapper.wrap(Buffer.alloc(32, 1));
    expect(wrapped).toMatchObject({
      kekId: 'https://vault.vault.azure.net/keys/llm-kek',
      kekVersion: 'abc123',
      algorithm: 'RSA-OAEP-256',
    });
  });

  it('the API source contains no decryption or unwrap code path (ADR-0010)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk(join(import.meta.dirname, '../../src'));
    const offenders = files.filter((file) =>
      /createDecipheriv|\.unwrapKey\(|\.decrypt\(/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
