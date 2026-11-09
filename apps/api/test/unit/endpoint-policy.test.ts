import { describe, expect, it } from 'vitest';
import { checkProviderEndpoint, isBlockedAddress } from '../../src/credentials/endpoint-policy.js';

const prod = { production: true, allowedPrivateHosts: [] as string[] };
const dev = { production: false, allowedPrivateHosts: [] as string[] };

describe('provider endpoint SSRF policy', () => {
  it.each([
    'https://127.0.0.1',
    'https://10.1.2.3',
    'https://172.20.0.1',
    'https://192.168.1.1',
    'https://169.254.169.254',
    'https://100.64.0.1',
    'https://0.0.0.0',
    'https://[::1]',
    'https://[fd00::1]',
    'https://[fe80::1]',
    'https://[::ffff:127.0.0.1]',
    'https://[::ffff:a9fe:a9fe]',
    'https://localhost',
    'https://api.localhost',
    'https://metadata.google.internal',
    'https://ollama',
    'http://myresource.openai.azure.com',
  ])('blocks %s in production', (url) => {
    expect(checkProviderEndpoint(url, prod)).not.toBeNull();
  });

  it.each([
    'https://user:pw@x.openai.azure.com',
    'https://x.openai.azure.com/?a=1',
    'https://x.openai.azure.com/#f',
    'ftp://x.com',
  ])('always blocks %s', (url) => {
    expect(checkProviderEndpoint(url, dev)).not.toBeNull();
    expect(checkProviderEndpoint(url, prod)).not.toBeNull();
  });

  it('accepts public https endpoints and allows local Ollama in development', () => {
    expect(checkProviderEndpoint('https://myresource.openai.azure.com', prod)).toBeNull();
    expect(checkProviderEndpoint('http://localhost:11434', dev)).toBeNull();
  });

  it('honours the operator private-host allowlist in production', () => {
    expect(
      checkProviderEndpoint('https://ollama.corp.internal', {
        production: true,
        allowedPrivateHosts: ['ollama.corp.internal'],
      }),
    ).toBeNull();
  });

  it('classifies addresses for runtime re-checks', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('2606:4700::1')).toBe(false);
  });
});
