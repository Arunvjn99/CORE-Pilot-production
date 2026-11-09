import { DefaultAzureCredential } from '@azure/identity';
import { CryptographyClient } from '@azure/keyvault-keys';
import type { AppConfig } from '../../config/env.js';
import { AzureKeyVaultKeyWrapper, type KeyWrapper, LocalKeyWrapper } from './key-wrapper.js';

export const KEY_WRAPPER = Symbol('KEY_WRAPPER');

export function createKeyWrapper(config: AppConfig): KeyWrapper {
  if (config.CREDENTIAL_KEK_PROVIDER === 'azure-key-vault') {
    if (!config.AZURE_KEY_VAULT_KEY_ID) throw new Error('AZURE_KEY_VAULT_KEY_ID is required');
    // Managed identity in Azure Container Apps; no secrets in configuration.
    return new AzureKeyVaultKeyWrapper(
      new CryptographyClient(config.AZURE_KEY_VAULT_KEY_ID, new DefaultAzureCredential()),
    );
  }
  if (!config.LOCAL_KEK) throw new Error('LOCAL_KEK is required for the local key wrapper');
  return new LocalKeyWrapper(config.LOCAL_KEK);
}
