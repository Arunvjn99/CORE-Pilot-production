import { createCipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Wraps (encrypts) data-encryption keys with a key-encryption key. The API holds ONLY this capability:
 * there is deliberately no unwrap method, so the control plane can store secrets but never read them
 * (ADR-0010). Unwrapping exists only in the AI runtime.
 */
export interface KeyWrapper {
  readonly kind: 'local' | 'azure-key-vault';
  wrap(dek: Buffer): Promise<WrappedKey>;
}

export interface WrappedKey {
  wrappedDek: Buffer;
  kekId: string;
  kekVersion: string;
  algorithm: 'A256GCM-KW' | 'RSA-OAEP-256';
}

export const LOCAL_KEK_AAD = Buffer.from('core-kek:local:v1');

/** Development/test only: AES-256-GCM key wrap with a KEK from the environment. Refused in production by config validation. */
export class LocalKeyWrapper implements KeyWrapper {
  readonly kind = 'local' as const;
  private readonly kek: Buffer;
  private readonly version: string;

  constructor(kekBase64: string) {
    const kek = Buffer.from(kekBase64, 'base64');
    if (kek.length !== 32) throw new Error('LOCAL_KEK must be 32 bytes (base64)');
    this.kek = kek;
    this.version = createHash('sha256').update(kek).digest('hex').slice(0, 16);
  }

  wrap(dek: Buffer): Promise<WrappedKey> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.kek, iv);
    cipher.setAAD(LOCAL_KEK_AAD);
    const body = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Promise.resolve({
      wrappedDek: Buffer.concat([iv, body, cipher.getAuthTag()]),
      kekId: 'local',
      kekVersion: this.version,
      algorithm: 'A256GCM-KW',
    });
  }
}

/** Minimal surface of @azure/keyvault-keys CryptographyClient used here (eases testing). */
export interface KeyVaultCryptoClient {
  wrapKey(
    algorithm: 'RSA-OAEP-256',
    key: Uint8Array,
  ): Promise<{ result: Uint8Array; keyID?: string }>;
}

/**
 * Production: RSA-OAEP-256 wrap with an HSM-backed Key Vault key. The API's managed identity is granted
 * only the `wrapKey` data action (Key Vault Crypto Service Encryption User style role), never `unwrapKey`.
 */
export class AzureKeyVaultKeyWrapper implements KeyWrapper {
  readonly kind = 'azure-key-vault' as const;

  constructor(private readonly client: KeyVaultCryptoClient) {}

  async wrap(dek: Buffer): Promise<WrappedKey> {
    const { result, keyID } = await this.client.wrapKey('RSA-OAEP-256', dek);
    if (!keyID) throw new Error('Key Vault did not return the key id used for wrapping');
    const url = new URL(keyID);
    const [, , name, version] = url.pathname.split('/');
    if (!name || !version) throw new Error('Unexpected Key Vault key id format');
    return {
      wrappedDek: Buffer.from(result),
      kekId: `${url.origin}/keys/${name}`,
      kekVersion: version,
      algorithm: 'RSA-OAEP-256',
    };
  }
}
